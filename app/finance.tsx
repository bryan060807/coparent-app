"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FinanceView,
  Expense,
  Payment,
  SavingGoal,
  FinanceItem,
  FinanceEvent,
} from "../lib/finance-types";
import { dollars, money, parseDollars, savedTotal } from "../lib/finance-money";
import { displayTime } from "../lib/appearance";
type Editing = { op: string; item?: Expense | SavingGoal | FinanceItem };
const today = () => new Date().toLocaleDateString("en-CA");
const day = (value: string) =>
  value ? new Date(value + "T12:00:00").toLocaleDateString() : "No target date";
const paymentLabels = {
  prepared: "Ready to send · not paid",
  sent: "Sent · awaiting receipt",
  received: "Receipt confirmed",
  not_received: "Not received · follow up",
  cancelled: "Closed · no receipt confirmed",
};
export default function FinancePanel({ viewer }: { viewer: string }) {
  const [data, setData] = useState<FinanceView | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("Expenses"),
    [editing, setEditing] = useState<Editing | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const live = useRef(true),
    sequence = useRef(0),
    lock = useRef(false),
    actionKeys = useRef<Record<string, string>>({});
  const accept = useCallback(
    (b: FinanceView) => {
      if (b.viewer !== viewer) {
        setData(null);
        window.dispatchEvent(new Event("team-account-change"));
        throw Error("The signed-in account changed. Reload this page.");
      }
      if (live.current) setData(b);
    },
    [viewer],
  );
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    try {
      const r = await fetch("/api/finance", { cache: "no-store" }),
        b = await r.json();
      if (!live.current || ticket !== sequence.current) return;
      if (!r.ok) throw Error(b.error);
      accept(b);
      setError("");
    } catch (e) {
      if (live.current && ticket === sequence.current)
        setError((e as Error).message);
    }
  }, [accept]);
  useEffect(() => {
    live.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      live.current = false;
      ++sequence.current;
      clearInterval(timer);
    };
  }, [refresh]);
  async function save(body: Record<string, unknown>) {
    const r = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, viewer }),
      }),
      b = await r.json();
    if (!r.ok) throw Error(b.error);
    ++sequence.current;
    accept(b);
    setError("");
    return b as FinanceView;
  }
  async function action(op: string, item: FinanceItem) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    const id = `${op}:${item.id}:${item.version}`,
      key = (actionKeys.current[id] ??= crypto.randomUUID());
    try {
      await save({ op, id: item.id, version: item.version, key });
      setNotice("Saved for both parents.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section>
        <h1>Family finances</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Loading your shared records…"}
        </p>
        <button onClick={() => void refresh()}>Retry</button>
      </section>
    );
  const name = (id: string) =>
      data.members.find((m) => m.id === id)?.name ?? "Parent",
    myBalance = data.balances[viewer] ?? 0;
  const open = (op: string, item?: Editing["item"]) => {
    setEditing({ op, item });
    setNotice("");
    setError("");
  };
  if (editing)
    return (
      <FinanceEditor
        key={editing.op + (editing.item?.id ?? "new")}
        editing={editing}
        data={data}
        save={save}
        onClose={() => {
          setEditing(null);
          setNotice("Saved for both parents.");
        }}
        onCancel={() => setEditing(null)}
      />
    );
  return (
    <section className="finance-panel">
      <p className="section-kicker">A shared plan, fewer loose ends</p>
      <h1>Family finances</h1>
      <p>
        Expenses, money between parents, and plans for the future. All amounts
        are USD.
      </p>
      <article className="hub-card finance-summary">
        <small>Shared expense balance</small>
        <strong>{money(Math.abs(myBalance))}</strong>
        <p>
          {myBalance > 0
            ? "You are owed"
            : myBalance < 0
              ? "You owe"
              : "You’re square"}{" "}
          · based on recorded expenses and recipient-confirmed reimbursements.
        </p>
        <p className="muted">
          Payments awaiting receipt do not settle this balance. Gifts and other
          transfers are separate.
        </p>
      </article>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <nav className="settings-tabs" aria-label="Finance sections">
        {["Expenses", "Payments", "Savings", "My PayPal"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : "secondary"}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Expenses" && (
        <>
          <h2>Shared expenses</h2>
          <p>
            Record what was paid and how you’re splitting it. Either parent can
            edit a record; every change stays in its history.
          </p>
          <button onClick={() => open("expense")}>Add expense</button>
          {!data.expenses.length && (
            <div className="note">
              <h3>Start with one receipt</h3>
              <p>
                School supplies, a doctor visit, or a family trip. A 50/50 split
                is ready to use, and you can change it.
              </p>
            </div>
          )}
          {[...data.expenses]
            .sort(
              (a, b) =>
                Number(a.voided) - Number(b.voided) ||
                b.date.localeCompare(a.date),
            )
            .map((e) => (
              <article className="hub-card" key={e.id}>
                <span className="hub-chip">
                  {e.voided ? "Voided · excluded" : e.category}
                </span>
                <h3>{e.title}</h3>
                <p className="finance-amount">{money(e.amount)}</p>
                <p>
                  {day(e.date)} · paid by {name(e.paidBy)}
                </p>
                <p>
                  {data.members
                    .map((m) => `${m.name}: ${money(e.shares[m.id] ?? 0)}`)
                    .join(" · ")}
                </p>
                {e.note && <p className="prewrap">{e.note}</p>}
                {!e.voided && (
                  <div className="finance-actions">
                    <button
                      className="secondary"
                      onClick={() => open("expense", e)}
                    >
                      Edit expense
                    </button>
                    <button
                      className="text"
                      onClick={() => open("voidExpense", e)}
                    >
                      Void expense
                    </button>
                  </div>
                )}
                <History
                  events={data.events.filter((v) => v.entity === e.id)}
                />
              </article>
            ))}
        </>
      )}
      {tab === "Payments" && (
        <>
          <h2>Money between parents</h2>
          <p>
            Prepare a PayPal handoff or record another method. You send the
            money yourself; the recipient confirms it arrived. The app never
            charges an account.
          </p>
          <button onClick={() => open("payment")}>Prepare payment</button>
          {!data.payments.length && (
            <p className="note">
              No payments recorded. Each parent can add their own PayPal.Me
              username under My PayPal, or use another method.
            </p>
          )}
          {[...data.payments].reverse().map((p) => (
            <article className="hub-card" key={p.id}>
              <span className="hub-chip">{paymentLabels[p.status]}</span>
              <h3>{p.reason}</h3>
              <p className="finance-amount">{money(p.amount)}</p>
              <p>
                {name(p.sender)} → {name(p.recipient)}
              </p>
              <p>
                {p.purpose === "reimbursement"
                  ? "Reimburses shared expenses"
                  : "Other money · does not change expense balance"}{" "}
                · {p.method === "paypal" ? "PayPal handoff" : "Other method"}
              </p>
              {p.status === "prepared" && p.sender === viewer && (
                <>
                  {p.method === "paypal" && (
                    <>
                      <p>
                        Recipient link: paypal.me/{p.handle}. Verify the
                        recipient and amount on PayPal before paying. Opening
                        this link does not record a payment.
                      </p>
                      <a
                        className="attachment"
                        href={`/api/finance/payments/${p.id}/paypal`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Open PayPal to send {money(p.amount)} ↗
                      </a>
                    </>
                  )}
                  <div className="finance-actions">
                    <button
                      disabled={busy}
                      onClick={() => void action("sent", p)}
                    >
                      I sent this money
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void action("cancelPayment", p)}
                    >
                      Cancel unsent record
                    </button>
                  </div>
                </>
              )}
              {p.status === "prepared" && p.recipient === viewer && (
                <p>Waiting for {name(p.sender)} to send the money.</p>
              )}
              {["sent", "not_received"].includes(p.status) &&
                p.recipient === viewer && (
                  <div className="finance-actions">
                    <button
                      disabled={busy}
                      onClick={() => void action("received", p)}
                    >
                      I received {money(p.amount)}
                    </button>
                    {p.status === "sent" && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void action("notReceived", p)}
                      >
                        I haven’t received it
                      </button>
                    )}
                  </div>
                )}
              {["sent", "not_received"].includes(p.status) &&
                p.sender === viewer && (
                  <p>
                    {p.status === "not_received"
                      ? "The recipient has not received this money. Check the transfer together; avoid paying twice."
                      : "Awaiting the recipient’s confirmation. Avoid paying twice."}
                  </p>
                )}
              {p.status === "received" && (
                <p>
                  Confirmed by the recipient, not verified by PayPal.
                  Corrections need a separate record; this receipt stays in
                  history.
                </p>
              )}
              {p.status === "not_received" && p.recipient === viewer && (
                <button
                  className="text"
                  onClick={() => open("closeUnreceived", p)}
                >
                  Close record without receipt
                </button>
              )}
              {p.status === "cancelled" && (
                <p>
                  This record does not settle the expense balance. Check the
                  actual transfer before recording another payment.
                </p>
              )}
              <History events={data.events.filter((e) => e.entity === p.id)} />
            </article>
          ))}
        </>
      )}
      {tab === "Savings" && (
        <>
          <h2>Plans for the future</h2>
          <p>
            Set a goal together and record money you’ve set aside elsewhere.
            These are manual records, not bank balances or automatic transfers.
          </p>
          <button onClick={() => open("goal")}>Add savings goal</button>
          {!data.goals.length && (
            <p className="note">
              College, a trip, or an emergency fund—give your next plan a name
              and a target.
            </p>
          )}
          {[...data.goals]
            .sort((a, b) => Number(a.archived) - Number(b.archived))
            .map((g) => {
              const total = savedTotal(data, g.id),
                entries = data.contributions.filter((c) => c.goal === g.id);
              return (
                <article className="hub-card" key={g.id}>
                  <span className="hub-chip">
                    {g.archived ? "Archived" : g.category}
                  </span>
                  <h3>{g.title}</h3>
                  <p>
                    <strong>{money(total)}</strong> recorded of{" "}
                    {money(g.target)}
                  </p>
                  <progress
                    value={Math.min(total, g.target)}
                    max={g.target}
                    aria-label={`${g.title} savings progress`}
                  />
                  <p>
                    {money(Math.max(0, g.target - total))} to go · {day(g.date)}
                  </p>
                  {g.note && <p className="prewrap">{g.note}</p>}
                  <div className="finance-actions">
                    {!g.archived && (
                      <>
                        <button onClick={() => open("contribution", g)}>
                          Record savings entry
                        </button>
                        <button
                          className="secondary"
                          onClick={() => open("goal", g)}
                        >
                          Edit goal
                        </button>
                      </>
                    )}
                    <button
                      className="text"
                      disabled={busy}
                      onClick={() => void action("archiveGoal", g)}
                    >
                      {g.archived ? "Restore goal" : "Archive goal"}
                    </button>
                  </div>
                  <details>
                    <summary>Contribution history ({entries.length})</summary>
                    {!entries.length && <p>No entries yet.</p>}
                    {[...entries].reverse().map((c) => (
                      <div className="finance-entry" key={c.id}>
                        <p>
                          <strong>
                            {c.voided ? "Voided · " : ""}
                            {c.direction === "deposit" ? "+" : "−"}
                            {money(c.amount)}
                          </strong>{" "}
                          · {name(c.by)} · {day(c.date)}
                        </p>
                        {c.note && <p>{c.note}</p>}
                        {!c.voided && c.by === viewer && (
                          <button
                            className="text"
                            onClick={() => open("voidContribution", c)}
                          >
                            Void my entry
                          </button>
                        )}
                      </div>
                    ))}
                  </details>
                  <History
                    events={data.events.filter(
                      (e) =>
                        e.entity === g.id ||
                        ("goal" in e.snapshot && e.snapshot.goal === g.id),
                    )}
                  />
                </article>
              );
            })}
        </>
      )}
      {tab === "My PayPal" && (
        <>
          <h2>My payment link</h2>
          <p>
            Add your PayPal.Me username, the part after paypal.me/, and we’ll
            build your payment link. Only you can change it. This does not
            connect or grant access to your PayPal account.
          </p>
          <p>
            {data.links[viewer]?.handle
              ? `paypal.me/${data.links[viewer].handle}`
              : "You haven’t added a link yet."}
          </p>
          <button onClick={() => open("link")}>Edit my PayPal link</button>
          {data.members
            .filter((m) => m.id !== viewer)
            .map((m) => (
              <article className="hub-card" key={m.id}>
                <h3>{m.name}</h3>
                <p>
                  {data.links[m.id]?.handle
                    ? `paypal.me/${data.links[m.id].handle}`
                    : "No PayPal.Me link saved. They can add it from their account."}
                </p>
              </article>
            ))}
        </>
      )}
    </section>
  );
}
function History({ events }: { events: FinanceEvent[] }) {
  return (
    <details className="finance-history">
      <summary>Activity ({events.length})</summary>
      <ol className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <strong>{e.action}</strong>
            <p>
              {e.name} · {displayTime(e.at)}
            </p>
            <details>
              <summary>Recorded details</summary>
              <Snapshot event={e} />
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
function Snapshot({ event }: { event: FinanceEvent }) {
  const s = event.snapshot;
  return (
    <div className="muted">
      {"title" in s && <p>{s.title}</p>}
      {"amount" in s && <p>{money(s.amount)}</p>}
      {"shares" in s && (
        <p>Shares: {Object.values(s.shares).map(money).join(" / ")}</p>
      )}
      {"reason" in s && (
        <p>
          {s.reason} · {paymentLabels[s.status]}
        </p>
      )}
      {"target" in s && <p>Target: {money(s.target)}</p>}
      {"date" in s && s.date && <p>{day(s.date)}</p>}
      {"note" in s && s.note && <p>{s.note}</p>}
      {"handle" in s && !("sender" in s) && (
        <p>{s.handle ? `paypal.me/${s.handle}` : "Link removed"}</p>
      )}
    </div>
  );
}
function FinanceEditor({
  editing,
  data,
  save,
  onClose,
  onCancel,
}: {
  editing: Editing;
  data: FinanceView;
  save: (b: Record<string, unknown>) => Promise<FinanceView>;
  onClose: () => void;
  onCancel: () => void;
}) {
  const { op, item } = editing,
    e = item as Expense | undefined,
    g = item as SavingGoal | undefined;
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    title: (e?.title ?? g?.title) || "",
    category:
      (e?.category ?? g?.category) || (op === "goal" ? "college" : "school"),
    amount: e?.amount ? dollars(e.amount) : "",
    target: g?.target ? dollars(g.target) : "",
    paidBy: e?.paidBy ?? data.viewer,
    date: op === "goal" ? (g?.date ?? "") : (e?.date ?? today()),
    note: op.startsWith("void") ? "" : (e?.note ?? g?.note ?? ""),
    myShare: e?.shares ? dollars(e.shares[data.viewer] ?? 0) : "",
    split: e ? "custom" : "equal",
    recipient: data.members.find((m) => m.id !== data.viewer)?.id ?? "",
    purpose: (data.balances[data.viewer] ?? 0) < 0 ? "reimbursement" : "other",
    method: "paypal",
    reason: "",
    direction: "deposit",
    handle: data.links[data.viewer]?.handle ?? "",
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loadedVersion, setLoadedVersion] = useState(
      op === "link" ? (data.links[data.viewer]?.version ?? 0) : item?.version,
    );
  const key = useRef(crypto.randomUUID()),
    locked = useRef(false);
  const versionNow =
    op === "expense" || op === "voidExpense"
      ? data.expenses.find((i) => i.id === item?.id)?.version
      : op === "goal" || op === "contribution"
        ? data.goals.find((i) => i.id === item?.id)?.version
        : op === "voidContribution"
          ? data.contributions.find((i) => i.id === item?.id)?.version
          : op === "closeUnreceived"
            ? data.payments.find((i) => i.id === item?.id)?.version
            : op === "link"
              ? (data.links[data.viewer]?.version ?? 0)
              : undefined;
  const stale =
    (item && op !== "contribution" && loadedVersion !== versionNow) ||
    (op === "link" && loadedVersion !== versionNow);
  const change = (field: string, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    key.current = crypto.randomUUID();
  };
  function loadLatest() {
    const latest =
      op.includes("Expense") || op === "expense"
        ? data.expenses.find((i) => i.id === item?.id)
        : data.goals.find((i) => i.id === item?.id);
    if (op === "link")
      setDraft((d) => ({
        ...d,
        handle: data.links[data.viewer]?.handle ?? "",
      }));
    else if (latest && !op.startsWith("void"))
      setDraft((d) => ({
        ...d,
        title: latest.title,
        category: latest.category,
        note: latest.note,
        date: latest.date,
        ...("amount" in latest
          ? {
              amount: dollars(latest.amount),
              paidBy: latest.paidBy,
              myShare: dollars(latest.shares[data.viewer] ?? 0),
              split: "custom",
            }
          : { target: dollars(latest.target) }),
      }));
    setLoadedVersion(versionNow);
    key.current = crypto.randomUUID();
    setError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || stale) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        ...draft,
        op,
        id: item?.id,
        version: loadedVersion,
        key: key.current,
      };
      if (["expense", "payment", "contribution"].includes(op))
        body.amount = parseDollars(draft.amount);
      if (op === "goal") body.target = parseDollars(draft.target);
      if (op === "contribution") {
        body.goal = item!.id;
        delete body.id;
      }
      if (op === "expense") {
        const total = Number(body.amount),
          mine = data.members.findIndex((m) => m.id === data.viewer);
        const myShare =
          draft.split === "equal"
            ? Math.floor(total / data.members.length) +
              (mine === 0 ? total % data.members.length : 0)
            : parseDollars(draft.myShare);
        body.shares = Object.fromEntries(
          data.members.map((m) => [
            m.id,
            m.id === data.viewer ? myShare : total - myShare,
          ]),
        );
      }
      await save(body);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const field = (
    label: string,
    id: string,
    type = "text",
    required = true,
    maxLength = 120,
  ) => (
    <label>
      {label}
      <input
        value={draft[id] ?? ""}
        onChange={(ev) => change(id, ev.target.value)}
        type={type}
        required={required}
        maxLength={maxLength}
        {...(["amount", "target", "myShare"].includes(id)
          ? { inputMode: "decimal", placeholder: "0.00" }
          : {})}
      />
    </label>
  );
  const select = (
    label: string,
    id: string,
    options: { id: string; name: string }[],
  ) => (
    <label>
      {label}
      <select value={draft[id]} onChange={(ev) => change(id, ev.target.value)}>
        {options.map((o) => (
          <option value={o.id} key={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  const options = (items: string[]) =>
    items.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) }));
  const titles: Record<string, string> = {
    expense: item ? "Edit expense" : "Add expense",
    payment: "Prepare payment",
    goal: item ? "Edit savings goal" : "Add savings goal",
    contribution: "Record savings entry",
    link: "My PayPal link",
    voidExpense: "Void expense",
    voidContribution: "Void my savings entry",
    closeUnreceived: "Close an unreceived payment",
  };
  return (
    <section className="finance-editor">
      <button className="text back" onClick={onCancel}>
        ← Back to finances
      </button>
      <h1>{titles[op]}</h1>
      {stale && (
        <div className="note" role="alert">
          <p>
            This record changed. Your draft is kept. Load the latest to review
            it before saving.
          </p>
          <button className="secondary" onClick={loadLatest}>
            Load latest record
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        {["expense", "goal"].includes(op) && (
          <>
            {field("Title", "title")}
            {select(
              "Category",
              "category",
              options(
                op === "goal"
                  ? ["college", "trip", "medical", "emergency", "other"]
                  : ["school", "medical", "travel", "activities", "other"],
              ),
            )}
            {field(
              op === "goal" ? "Target amount (USD)" : "Total amount (USD)",
              op === "goal" ? "target" : "amount",
            )}
            {field(
              op === "goal" ? "Target date (optional)" : "Date paid",
              "date",
              "date",
              op !== "goal",
            )}
          </>
        )}
        {op === "expense" && (
          <>
            {select("Paid by", "paidBy", data.members)}
            {select("Split", "split", [
              { id: "equal", name: "50/50 between parents" },
              { id: "custom", name: "Custom shares" },
            ])}
            {draft.split === "custom" && field("My share (USD)", "myShare")}
            <SplitPreview draft={draft} data={data} />
          </>
        )}
        {op === "payment" && (
          <>
            <p>
              No money moves when you save this record. Check existing payments
              before sending again.
            </p>
            {select(
              "Send to",
              "recipient",
              data.members.filter((m) => m.id !== data.viewer),
            )}
            {field("Amount to send (USD)", "amount")}
            {field("What is it for?", "reason", "text", true, 300)}
            {select("Purpose", "purpose", [
              { id: "reimbursement", name: "Reimburse shared expenses" },
              { id: "other", name: "Other money · separate from expenses" },
            ])}
            {select("Method", "method", [
              { id: "paypal", name: "PayPal handoff" },
              { id: "other", name: "Cash, bank, or another method" },
            ])}
            <p className="muted">
              The sender marks it sent after paying. Only the recipient can
              confirm receipt. PayPal may show its own fees; check its final
              screen.
            </p>
          </>
        )}
        {op === "contribution" && (
          <>
            <p>
              For {g?.title}. Record money already moved or set aside outside
              this app.
            </p>
            {select(
              "Entry type",
              "direction",
              options(["deposit", "withdrawal"]),
            )}
            {field("Amount (USD)", "amount")}
            {field("Entry date", "date", "date")}
          </>
        )}
        {op === "link" && (
          <>
            <label>
              PayPal.Me username
              <input
                value={draft.handle}
                onChange={(event) => change("handle", event.target.value)}
                type="text"
                placeholder="e.g. WillowParent"
                maxLength={120}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="paypal-username-help"
              />
            </label>
            <p id="paypal-username-help">
              Enter just the username after <strong>paypal.me/</strong>. For
              example, for paypal.me/WillowParent, type{" "}
              <strong>WillowParent</strong>. We’ll build the full link for you.
              Pasting your full PayPal.Me link also works.
            </p>
            <p>
              Use your own link. Clear it to remove it. The other parent cannot
              change this setting.
            </p>
          </>
        )}
        {op !== "link" && op !== "payment" && (
          <label>
            {op.startsWith("void")
              ? "Reason for voiding"
              : op === "closeUnreceived"
                ? "Reason for closing"
                : "Notes (optional)"}
            <textarea
              value={draft.note}
              onChange={(ev) => change("note", ev.target.value)}
              required={op.startsWith("void") || op === "closeUnreceived"}
              maxLength={
                op.startsWith("void") || op === "closeUnreceived"
                  ? 300
                  : op === "contribution"
                    ? 500
                    : 1500
              }
            />
          </label>
        )}
        {op === "closeUnreceived" && (
          <p>
            Confirm that you have not received this money and the record should
            be closed. This releases the pending reimbursement amount and keeps
            the history. Check the transfer with the other parent before sending
            again.
          </p>
        )}
        {op.startsWith("void") && (
          <p>
            The record stays in history and is excluded from totals. Voiding an
            expense may change the balance even if a payment was already
            confirmed.
          </p>
        )}
        <div className="finance-actions">
          <button disabled={busy || !!stale}>
            {busy
              ? "Saving…"
              : op === "payment"
                ? "Save payment record"
                : "Save"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
function SplitPreview({
  draft,
  data,
}: {
  draft: Record<string, string>;
  data: FinanceView;
}) {
  try {
    const total = parseDollars(draft.amount),
      index = data.members.findIndex((m) => m.id === data.viewer),
      share =
        draft.split === "equal"
          ? Math.floor(total / data.members.length) +
            (index === 0 ? total % data.members.length : 0)
          : parseDollars(draft.myShare);
    return (
      <p className="note">
        {data.members
          .map(
            (m) =>
              `${m.name}: ${money(m.id === data.viewer ? share : total - share)}`,
          )
          .join(" · ")}
        {total % 2 && draft.split === "equal"
          ? " · The first listed parent covers the extra cent."
          : ""}
      </p>
    );
  } catch {
    return (
      <p className="muted">
        Enter an amount to preview each parent’s share. Custom shares can be
        zero.
      </p>
    );
  }
}
