"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FamilyKind,
  FamilyData,
  FamilyRecord,
  FamilyList,
  FamilyDetail,
  GiftData,
  RoutineData,
  InfoData,
  FamilyContext,
} from "../lib/family-types";
type Member = { id: string; name: string };
const key = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const money = (cents: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
const date = (day: string) =>
  new Date(day + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const titles: Record<FamilyKind, string> = {
  gifts: "Gifts & money",
  routines: "Routines & chores",
  info: "Health & personal info",
};
const addLabels: Record<FamilyKind, string> = {
  gifts: "Add gift or money",
  routines: "Add routine or chore",
  info: "Add info card",
};
const actionLabels: Record<string, string> = {
  created: "Added",
  edited: "Updated",
  archived: "Archived",
  restored: "Restored",
  checked: "Checked off",
  unchecked: "Unchecked",
};
function useFamily(kind: FamilyKind) {
  const [list, setList] = useState<FamilyList | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/family/" + kind);
      if (!r.ok) throw Error();
      setList(await r.json());
      setError("");
    } catch {
      setError(
        "Could not sync this section. Check your connection; we’ll retry.",
      );
    }
  }, [kind]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);
  return { list, error, refresh };
}
export function RoutineSummary({ onOpen }: { onOpen: () => void }) {
  const { list } = useFamily("routines");
  const active =
    list?.records.filter((r) => !r.archived && r.scheduledToday) ?? [];
  if (!active.length) return null;
  return (
    <section className="homework-summary" aria-label="Today’s routines">
      <div className="cardtop">
        <h2>Today’s checklist</h2>
        <button className="text" onClick={onOpen}>
          View routines
        </button>
      </div>
      <p>
        {active.filter((r) => r.check?.checked).length} of {active.length} done
        · {list!.context.timezone}
      </p>
    </section>
  );
}
function homeName(value: string, members: Member[]) {
  return value === "both"
    ? "Both homes"
    : (members.find((m) => m.id === value)?.name ?? "Parent") + "’s home";
}
function RecordData({
  item,
  members,
}: {
  item: FamilyRecord;
  members: Member[];
}) {
  if (item.kind === "gifts") {
    const d = item.data as GiftData;
    return (
      <>
        <p className="eyebrow">
          {d.type === "gift"
            ? "Gift"
            : d.type === "money_in"
              ? "Money received"
              : "Money spent"}{" "}
          · {date(d.date)}
        </p>
        {d.amountCents !== null && (
          <p className="entry-amount">
            {money(d.amountCents)}
            {d.type === "gift" ? " estimated value" : ""}
          </p>
        )}
        {d.from && (
          <p>
            {d.type === "money_out" ? "Paid to / for" : "From"}: {d.from}
          </p>
        )}
        {d.occasion && <p>Occasion: {d.occasion}</p>}
        {d.type !== "money_out" && (
          <p>Thank-you: {d.thankYou ? "Sent" : "Still to send"}</p>
        )}
        {d.note && <p className="preserve-lines">{d.note}</p>}
      </>
    );
  }
  if (item.kind === "routines") {
    const d = item.data as RoutineData;
    return (
      <>
        <p>
          {d.type === "routine" ? "Routine" : "Chore"} ·{" "}
          {homeName(d.home, members)}
        </p>
        <p>
          {d.days.length === 7
            ? "Every day"
            : d.days.map((n) => days[n]).join(", ")}
          {d.time ? " · " + d.time : ""}
        </p>
        {d.note && <p className="preserve-lines">{d.note}</p>}
      </>
    );
  }
  const d = item.data as InfoData;
  return (
    <>
      <span className="badge">
        {d.category[0].toUpperCase() + d.category.slice(1)}
        {d.important ? " · Important" : ""}
      </span>
      <p className="preserve-lines">{d.details}</p>
    </>
  );
}
type Draft = {
  title: string;
  type: string;
  date: string;
  from: string;
  occasion: string;
  amount: string;
  thankYou: boolean;
  note: string;
  days: number[];
  time: string;
  home: string;
  category: string;
  details: string;
  important: boolean;
};
function draftFor(ctx: FamilyContext, item?: FamilyRecord): Draft {
  const blank: Draft = {
    title: "",
    type: item?.kind === "routines" ? "routine" : "gift",
    date: ctx.day,
    from: "",
    occasion: "",
    amount: "",
    thankYou: false,
    note: "",
    days: [0, 1, 2, 3, 4, 5, 6],
    time: "",
    home: "both",
    category: "health",
    details: "",
    important: false,
  };
  if (!item) return blank;
  if (item.kind === "gifts") {
    const d = item.data as GiftData;
    return {
      ...blank,
      ...d,
      amount: d.amountCents === null ? "" : (d.amountCents / 100).toFixed(2),
    };
  }
  return { ...blank, ...item.data };
}
function toData(kind: FamilyKind, d: Draft): FamilyData {
  if (kind === "gifts") {
    let cents: number | null = null;
    if (d.amount !== "") {
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(d.amount))
        throw Error(
          "Enter an amount such as 25 or 25.50, with at most two decimal places.",
        );
      const [whole, fraction = ""] = d.amount.split(".");
      cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    }
    return {
      title: d.title,
      type: d.type as GiftData["type"],
      date: d.date,
      from: d.from,
      occasion: d.occasion,
      amountCents: cents,
      thankYou: d.thankYou,
      note: d.note,
    };
  }
  if (kind === "routines")
    return {
      title: d.title,
      type: d.type as RoutineData["type"],
      days: d.days,
      time: d.time,
      home: d.home,
      note: d.note,
    };
  return {
    title: d.title,
    category: d.category as InfoData["category"],
    details: d.details,
    important: d.important,
  };
}
export default function FamilySection({
  kind,
  members,
}: {
  kind: FamilyKind;
  members: Member[];
}) {
  const { list, error: syncError, refresh } = useFamily(kind);
  const [selected, setSelected] = useState<FamilyDetail | null>(null),
    [form, setForm] = useState<"add" | "edit" | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [formVersion, setFormVersion] = useState(0),
    [formKey, setFormKey] = useState(""),
    [filter, setFilter] = useState(kind === "routines" ? "today" : "active"),
    [home, setHome] = useState("all"),
    [category, setCategory] = useState("all"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pendingCheck, setPendingCheck] = useState<{
      id: string;
      checked: boolean;
    } | null>(null),
    [archiveConfirm, setArchiveConfirm] = useState(false),
    [zoneForm, setZoneForm] = useState<{
      value: string;
      version: number;
      key: string;
    } | null>(null);
  const saving = useRef(false),
    last = useRef({ signature: "", key: "" });
  const fetchDetail = useCallback(
    async (id: string) => {
      const r = await fetch("/api/family/" + kind + "/" + id);
      if (!r.ok) throw Error("Could not open this record. Try again.");
      return (await r.json()) as FamilyDetail;
    },
    [kind],
  );
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const id = selected.record.id;
    const timer = setInterval(async () => {
      try {
        const d = await fetchDetail(id);
        if (live) setSelected(d);
      } catch {
        /* the list reports sync failures */
      }
    }, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selected?.record.id, fetchDetail]);
  const ctx = list?.context;
  function begin(item?: FamilyRecord) {
    if (!ctx) return;
    const value = draftFor(ctx, item);
    if (!item && kind === "routines") value.type = "routine";
    setDraft(value);
    setForm(item ? "edit" : "add");
    setFormVersion(item?.version ?? 0);
    setFormKey(key());
    setError("");
    setNotice("");
    setArchiveConfirm(false);
  }
  async function send(
    id: string | undefined,
    body: object,
    selectResult = true,
  ) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/family/" + kind + (id ? "/" + id : ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 409 && id && selectResult)
          setSelected(await fetchDetail(id));
        await refresh();
        throw Error(data.error);
      }
      if (selectResult) setSelected(data);
      await refresh();
      return data as FamilyDetail;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your draft is kept; try again.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    try {
      const d = toData(kind, draft);
      const result = await send(
        form === "edit" ? selected?.record.id : undefined,
        { action: "edit", version: formVersion, data: d, key: formKey },
      );
      if (result) {
        setForm(null);
        setNotice("Saved for both parents.");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function act(item: FamilyRecord, action: string, extra: object = {}) {
    const body = { action, version: item.version, ...extra };
    const signature = JSON.stringify({ id: item.id, ...body });
    if (last.current.signature !== signature)
      last.current = { signature, key: key() };
    const result = await send(
      item.id,
      { ...body, key: last.current.key },
      !!selected,
    );
    if (result) {
      setArchiveConfirm(false);
      setNotice(
        action === "archive"
          ? "Archived. You can restore it from Archived."
          : action === "restore"
            ? "Restored for both parents."
            : "Checklist updated for both parents.",
      );
    }
  }
  async function saveZone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!zoneForm || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/family/routines/timezone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: zoneForm.value,
          version: zoneForm.version,
          key: zoneForm.key,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setZoneForm(null);
      setNotice("Routine time zone updated for both parents.");
      await refresh();
      if (selected) setSelected(await fetchDetail(selected.record.id));
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function check(item: FamilyRecord, checked: boolean) {
    if (saving.current) return;
    setPendingCheck({ id: item.id, checked });
    try {
      await act(item, "check", {
        checked,
        day: item.check!.day,
        dayVersion: item.check!.version,
        timezoneVersion: ctx!.timezoneVersion,
      });
    } finally {
      setPendingCheck(null);
    }
  }
  const stale = !!(
    form === "edit" &&
    selected &&
    (selected.record.version !== formVersion || selected.record.archived)
  );
  let records =
    list?.records.filter((r) =>
      filter === "archived" ? r.archived : !r.archived,
    ) ?? [];
  if (kind === "routines")
    records = records
      .filter(
        (r) =>
          (filter !== "today" || r.scheduledToday) &&
          (home === "all" ||
            (r.data as RoutineData).home === home ||
            (home !== "both" && (r.data as RoutineData).home === "both")),
      )
      .sort(
        (a, b) =>
          ((a.data as RoutineData).time || "99:99").localeCompare(
            (b.data as RoutineData).time || "99:99",
          ) || a.data.title.localeCompare(b.data.title),
      );
  if (kind === "gifts")
    records.sort(
      (a, b) =>
        (b.data as GiftData).date.localeCompare((a.data as GiftData).date) ||
        b.created_at.localeCompare(a.created_at),
    );
  if (kind === "info")
    records = records
      .filter(
        (r) => category === "all" || (r.data as InfoData).category === category,
      )
      .sort(
        (a, b) =>
          Number((b.data as InfoData).important) -
            Number((a.data as InfoData).important) ||
          a.data.title.localeCompare(b.data.title),
      );
  if (!ctx)
    return (
      <div>
        <h1>{titles[kind]}</h1>
        <p role="status">{syncError || "Loading…"}</p>
      </div>
    );
  const item = selected?.record;
  return (
    <div className="family-section">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {syncError && (
        <p className="error" role="status">
          {syncError}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {form && draft ? (
        <>
          <button
            className="text back"
            disabled={busy}
            onClick={() => {
              setForm(null);
              setError("");
            }}
          >
            ← Back to {item ? "record" : titles[kind]}
          </button>
          <h1>{form === "add" ? addLabels[kind] : "Edit record"}</h1>
          {stale && (
            <div className="note" role="status">
              <strong>This record changed while you were editing.</strong>
              <p>
                Your draft is kept below. Review the current details before
                saving.
              </p>
              {item && <RecordData item={item} members={members} />}
              <button
                className="text"
                onClick={() => item && begin(item)}
                disabled={item?.archived}
              >
                Discard my draft and load latest details
              </button>
            </div>
          )}
          <form onSubmit={save}>
            <label>
              {kind === "gifts"
                ? "Entry title"
                : kind === "routines"
                  ? "Task name"
                  : "Info title"}
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={
                  kind === "gifts"
                    ? "e.g. Birthday money"
                    : kind === "routines"
                      ? "e.g. Brush teeth"
                      : "e.g. Allergies, doctor, clothing sizes"
                }
              />
            </label>
            {kind === "gifts" ? (
              <>
                <label>
                  Entry type
                  <select
                    value={draft.type}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        type: e.target.value,
                        thankYou:
                          e.target.value === "money_out"
                            ? false
                            : draft.thankYou,
                      })
                    }
                  >
                    <option value="gift">Gift</option>
                    <option value="money_in">Money received</option>
                    <option value="money_out">Money spent</option>
                  </select>
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    required
                    value={draft.date}
                    onChange={(e) =>
                      setDraft({ ...draft, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  {draft.type === "money_out" ? "Paid to / for" : "From"}{" "}
                  <span className="muted">(optional)</span>
                  <input
                    maxLength={120}
                    value={draft.from}
                    onChange={(e) =>
                      setDraft({ ...draft, from: e.target.value })
                    }
                  />
                </label>
                <label>
                  Occasion <span className="muted">(optional)</span>
                  <input
                    maxLength={120}
                    value={draft.occasion}
                    onChange={(e) =>
                      setDraft({ ...draft, occasion: e.target.value })
                    }
                    placeholder="Birthday, holiday, just because"
                  />
                </label>
                <label>
                  {draft.type === "gift"
                    ? "Estimated value in USD (optional)"
                    : "Amount in USD"}
                  <input
                    inputMode="decimal"
                    required={draft.type !== "gift"}
                    value={draft.amount}
                    onChange={(e) =>
                      setDraft({ ...draft, amount: e.target.value })
                    }
                    placeholder="25.00"
                    maxLength={12}
                  />
                </label>
                {draft.type !== "money_out" && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={draft.thankYou}
                      onChange={(e) =>
                        setDraft({ ...draft, thankYou: e.target.checked })
                      }
                    />
                    Thank-you sent
                  </label>
                )}
                <label>
                  Entry note <span className="muted">(optional)</span>
                  <textarea
                    maxLength={500}
                    value={draft.note}
                    onChange={(e) =>
                      setDraft({ ...draft, note: e.target.value })
                    }
                  />
                </label>
              </>
            ) : kind === "routines" ? (
              <>
                <label>
                  Task type
                  <select
                    value={draft.type}
                    onChange={(e) =>
                      setDraft({ ...draft, type: e.target.value })
                    }
                  >
                    <option value="routine">Routine</option>
                    <option value="chore">Chore</option>
                  </select>
                </label>
                <label>
                  Repeats
                  <select
                    value={draft.days.length === 7 ? "daily" : "weekly"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        days:
                          e.target.value === "daily"
                            ? [0, 1, 2, 3, 4, 5, 6]
                            : [ctx.weekday],
                      })
                    }
                  >
                    <option value="daily">Every day</option>
                    <option value="weekly">Choose weekdays</option>
                  </select>
                </label>
                {draft.days.length !== 7 && (
                  <fieldset className="weekdays">
                    <legend>Weekdays</legend>
                    {days.map((day, n) => (
                      <label className="check-label" key={day}>
                        <input
                          type="checkbox"
                          checked={draft.days.includes(n)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              days: e.target.checked
                                ? [...draft.days, n]
                                : draft.days.filter((d) => d !== n),
                            })
                          }
                        />
                        {day}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label>
                  Time <span className="muted">(optional)</span>
                  <input
                    type="time"
                    value={draft.time}
                    onChange={(e) =>
                      setDraft({ ...draft, time: e.target.value })
                    }
                  />
                </label>
                <p className="muted">
                  Routine times and checkoff days use {ctx.timezone}.
                </p>
                <label>
                  Applies at
                  <select
                    value={draft.home}
                    onChange={(e) =>
                      setDraft({ ...draft, home: e.target.value })
                    }
                  >
                    <option value="both">Both homes</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}’s home
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Task instructions <span className="muted">(optional)</span>
                  <textarea
                    maxLength={500}
                    value={draft.note}
                    onChange={(e) =>
                      setDraft({ ...draft, note: e.target.value })
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <label htmlFor="family-info-category">Category</label>
                <select
                  id="family-info-category"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                >
                  <option value="health">Health</option>
                  <option value="personal">Personal</option>
                  <option value="emergency">Emergency contacts</option>
                  <option value="school">School</option>
                  <option value="other">Other</option>
                </select>
                <label htmlFor="family-info-details">Details</label>
                <textarea
                  id="family-info-details"
                  required
                  maxLength={4000}
                  value={draft.details}
                  onChange={(e) =>
                    setDraft({ ...draft, details: e.target.value })
                  }
                  placeholder="Add the details you want both parents to have."
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.important}
                    onChange={(e) =>
                      setDraft({ ...draft, important: e.target.checked })
                    }
                  />
                  Mark as important
                </label>
              </>
            )}
            <button disabled={busy || stale}>
              {busy ? "Saving…" : "Save record"}
            </button>
          </form>
        </>
      ) : item ? (
        <>
          <button
            className="text back"
            onClick={() => {
              setSelected(null);
              setArchiveConfirm(false);
              setError("");
              setNotice("");
            }}
          >
            ← Back to {titles[kind]}
          </button>
          {item.archived && <span className="badge">Archived</span>}
          <h1>{item.data.title}</h1>
          <RecordData item={item} members={members} />
          {kind === "routines" && !item.archived && (
            <div className="note">
              <p>
                {date(ctx.day)} · {ctx.timezone}
              </p>
              {item.scheduledToday ? (
                <label className="check-label">
                  <input
                    type="checkbox"
                    aria-label={item.data.title}
                    checked={
                      pendingCheck?.id === item.id
                        ? pendingCheck.checked
                        : !!item.check?.checked
                    }
                    disabled={busy}
                    onChange={(e) => check(item, e.target.checked)}
                  />
                  Done today
                </label>
              ) : (
                <p>Not scheduled today.</p>
              )}
              {item.check?.actor && (
                <p>
                  {item.check.checked ? "Checked off" : "Unchecked"} by{" "}
                  {item.check.actor}
                </p>
              )}
            </div>
          )}
          <div className="family-actions">
            {!item.archived && (
              <button onClick={() => begin(item)}>Edit record</button>
            )}
            {archiveConfirm ? (
              <div className="note">
                <p>Archive this record? It can be restored from Archived.</p>
                <button disabled={busy} onClick={() => act(item, "archive")}>
                  Confirm archive
                </button>
                <button
                  className="text"
                  onClick={() => setArchiveConfirm(false)}
                >
                  Keep record
                </button>
              </div>
            ) : (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  item.archived ? act(item, "restore") : setArchiveConfirm(true)
                }
              >
                {item.archived ? "Restore record" : "Archive record"}
              </button>
            )}
          </div>
          {kind === "routines" && selected!.checks.length > 0 && (
            <section>
              <h2>Recent checkoffs</h2>
              <p className="muted">
                Latest 30 recorded dates. Unchecked days stay in history.
              </p>
              <ul className="check-history">
                {selected!.checks.map((c) => (
                  <li key={c.day}>
                    {date(c.day)} · {c.checked ? "Done" : "Not done"} ·{" "}
                    {c.actor}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h2>Record activity</h2>
            <ol className="timeline">
              {selected!.events.map((e) => (
                <li key={e.id}>
                  <strong>
                    {actionLabels[e.action] || e.action} by {e.actor}
                  </strong>
                  <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>
                  {e.snapshot.day && (
                    <p>
                      Checklist day: {date(e.snapshot.day)}
                      {e.snapshot.timezone ? " · " + e.snapshot.timezone : ""}
                    </p>
                  )}
                  <details>
                    <summary>Details at this change</summary>
                    <RecordData item={e.snapshot} members={members} />
                  </details>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <>
          <h1>{titles[kind]}</h1>
          <p className="intro">
            {kind === "gifts"
              ? "Keep track of gifts, birthday money, and thank-yous."
              : kind === "routines"
                ? "A shared, editable checklist for both homes."
                : "The details both parents need, in one private household section."}
          </p>
          {kind === "gifts" && list?.totals && (
            <div
              className="money-summary"
              role="region"
              aria-label="Recorded cash totals"
            >
              <div>
                <small>Received</small>
                <strong>{money(list.totals.receivedCents)}</strong>
              </div>
              <div>
                <small>Spent</small>
                <strong>{money(list.totals.spentCents)}</strong>
              </div>
              <div>
                <small>Recorded balance</small>
                <strong>{money(list.totals.balanceCents)}</strong>
              </div>
              <p>USD · Active money entries only. Gift values are excluded.</p>
            </div>
          )}
          <button onClick={() => begin()}>{addLabels[kind]}</button>
          {kind === "routines" && (
            <>
              <p className="routine-day">
                <strong>{date(ctx.day)}</strong> · {ctx.timezone}
              </p>
              <button
                className="text"
                onClick={() => {
                  setZoneForm({
                    value: ctx.timezone,
                    version: ctx.timezoneVersion,
                    key: key(),
                  });
                  setError("");
                }}
              >
                Edit time zone
              </button>
              {zoneForm && (
                <form className="note" onSubmit={saveZone}>
                  <label>
                    Routine time zone
                    <input
                      required
                      maxLength={100}
                      value={zoneForm.value}
                      onChange={(e) =>
                        setZoneForm({ ...zoneForm, value: e.target.value })
                      }
                    />
                  </label>
                  <p className="muted">
                    Use an IANA name, such as America/Chicago. Both parents
                    share this setting.
                  </p>
                  {zoneForm.version !== ctx.timezoneVersion && (
                    <p role="status">
                      The setting changed elsewhere. Your input is kept.
                    </p>
                  )}
                  <button
                    disabled={busy || zoneForm.version !== ctx.timezoneVersion}
                  >
                    Save time zone
                  </button>
                  <button
                    type="button"
                    className="text"
                    onClick={() =>
                      setZoneForm({
                        value: ctx.timezone,
                        version: ctx.timezoneVersion,
                        key: key(),
                      })
                    }
                  >
                    Load latest time zone
                  </button>
                  <button
                    type="button"
                    className="text"
                    onClick={() => setZoneForm(null)}
                  >
                    Close settings
                  </button>
                </form>
              )}
            </>
          )}
          <div
            className="family-filters"
            role="group"
            aria-label="Record lists"
          >
            {(kind === "routines"
              ? ["today", "active", "archived"]
              : ["active", "archived"]
            ).map((value) => (
              <button
                key={value}
                className={filter === value ? "active" : "text"}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setNotice("");
                }}
              >
                {value === "today"
                  ? "Today"
                  : value === "archived"
                    ? "Archived"
                    : kind === "routines"
                      ? "All tasks"
                      : "Current entries"}
              </button>
            ))}
          </div>
          {kind === "routines" && (
            <label>
              Show homes
              <select value={home} onChange={(e) => setHome(e.target.value)}>
                <option value="all">All homes</option>
                <option value="both">Both homes</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}’s home
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "info" && (
            <label>
              Show category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All categories</option>
                {["health", "personal", "emergency", "school", "other"].map(
                  (value) => (
                    <option key={value} value={value}>
                      {value[0].toUpperCase() + value.slice(1)}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
          {kind === "routines" && filter === "today" && (
            <p role="status">
              {records.filter((r) => r.check?.checked).length} of{" "}
              {records.length} done today. Checkoffs start fresh each calendar
              day.
            </p>
          )}
          {!records.length ? (
            <section className="empty">
              <h2>
                {filter === "archived"
                  ? "No archived records"
                  : kind === "routines" && filter === "today"
                    ? "No tasks scheduled today"
                    : "Nothing added yet"}
              </h2>
              <p>
                {filter === "archived"
                  ? "Archived records will stay here until restored."
                  : kind === "gifts"
                    ? "Add a gift, money received, or money spent."
                    : kind === "routines"
                      ? "Add a routine or chore, or view All tasks to edit the schedule."
                      : "Add health notes, emergency contacts, school details, or personal information. You choose the titles and details."}
              </p>
            </section>
          ) : (
            <div className="cards">
              {records.map((r) =>
                kind === "routines" ? (
                  <article className="family-card" key={r.id}>
                    <label className="routine-check">
                      <input
                        type="checkbox"
                        aria-label={r.data.title}
                        checked={
                          pendingCheck?.id === r.id
                            ? pendingCheck.checked
                            : !!r.check?.checked
                        }
                        disabled={busy || r.archived || !r.scheduledToday}
                        onChange={(e) => check(r, e.target.checked)}
                      />
                      <span>
                        <strong>{r.data.title}</strong>
                        <small>
                          {(r.data as RoutineData).time || "Any time"} ·{" "}
                          {homeName((r.data as RoutineData).home, members)}
                          {!r.scheduledToday ? " · Not scheduled today" : ""}
                        </small>
                        {r.check?.actor && (
                          <small>
                            {r.check.checked ? "Done" : "Unchecked"} by{" "}
                            {r.check.actor}
                          </small>
                        )}
                      </span>
                    </label>
                    <button
                      className="text"
                      onClick={async () => {
                        try {
                          setSelected(await fetchDetail(r.id));
                          setError("");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Task details
                    </button>
                  </article>
                ) : (
                  <button
                    className="card"
                    key={r.id}
                    onClick={async () => {
                      try {
                        setSelected(await fetchDetail(r.id));
                        setError("");
                        setNotice("");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <h2>{r.data.title}</h2>
                    <RecordData item={r} members={members} />
                  </button>
                ),
              )}
            </div>
          )}
          <footer>Shared with your household · syncs every 3 seconds</footer>
        </>
      )}
    </div>
  );
}
