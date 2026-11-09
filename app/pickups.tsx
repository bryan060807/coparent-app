"use client";
import { displayDateTime, clockOptions } from "../lib/appearance";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Pickup, PickupDetail } from "../lib/pickup-types";
type Member = { id: string; name: string };
const key = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const when = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    ...clockOptions(),
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
const localInput = (value: string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const label = (pickup: Pickup) =>
  pickup.status === "completed"
    ? "Picked up"
    : pickup.status === "cancelled"
      ? "Cancelled"
      : Date.parse(pickup.scheduled_at) < Date.now()
        ? "Past pickup time · check status"
        : "Scheduled";
function usePickupList() {
  const [items, setItems] = useState<Pickup[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/pickups");
      if (!r.ok) throw Error();
      setItems(await r.json());
      setError("");
    } catch {
      setError("Could not sync pickups. Check your connection; we’ll retry.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { items, loading, error, refresh };
}
export function NextPickup({ onOpen }: { onOpen: () => void }) {
  const { items, loading, error } = usePickupList();
  const next = items.find((p) => p.status === "scheduled");
  return (
    <section className="pickup-summary" aria-label="Next pickup">
      <div className="cardtop">
        <h2>Next pickup</h2>
        <button className="text" onClick={onOpen}>
          View pickups
        </button>
      </div>
      {loading ? (
        <p>Loading pickups…</p>
      ) : error ? (
        <p role="status">{error}</p>
      ) : next ? (
        <>
          <p className="pickup-time">
            <time dateTime={next.scheduled_at}>
              <span className="pickup-date">
                {new Date(next.scheduled_at).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span className="pickup-clock">
                {new Date(next.scheduled_at).toLocaleTimeString(undefined, {
                  ...clockOptions(),
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
              </span>
            </time>
          </p>
          <p>
            <strong>{next.title}</strong> · {next.location}
          </p>
          <p>
            {next.assignee_name} is picking up
            {Date.parse(next.scheduled_at) < Date.now()
              ? " · Past pickup time; check status"
              : ""}
          </p>
        </>
      ) : (
        <p>No pickups planned yet. Choose View pickups to add the first one.</p>
      )}
    </section>
  );
}
type Draft = {
  title: string;
  when: string;
  location: string;
  assignee: string;
  note: string;
};
export default function PickupPlanner({
  members,
  me,
}: {
  members: Member[];
  me: Member;
}) {
  const { items, loading, error: syncError, refresh } = usePickupList();
  const [selected, setSelected] = useState<PickupDetail | null>(null),
    [form, setForm] = useState<"add" | "edit" | null>(null),
    [draft, setDraft] = useState<Draft>({
      title: "School pickup",
      when: "",
      location: "",
      assignee: me.id,
      note: "",
    }),
    [formVersion, setFormVersion] = useState(0),
    [formKey, setFormKey] = useState(""),
    [past, setPast] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{
      action: "complete" | "cancel";
      version: number;
      key: string;
    } | null>(null);
  const saving = useRef(false);
  const loadDetail = useCallback(async (id: string) => {
    const r = await fetch("/api/pickups/" + id);
    if (!r.ok) throw Error("Could not open this pickup. Please try again.");
    const body = (await r.json()) as PickupDetail;
    setSelected(body);
    return body;
  }, []);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const id = selected.id;
    const update = async () => {
      try {
        const r = await fetch("/api/pickups/" + id);
        if (r.ok && live) setSelected(await r.json());
      } catch {
        /* retry on the next poll */
      }
    };
    const timer = setInterval(update, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selected?.id]);
  function begin(item?: PickupDetail) {
    setDraft(
      item
        ? {
            title: item.title,
            when: localInput(item.scheduled_at),
            location: item.location,
            assignee: item.assignee,
            note: item.note,
          }
        : {
            title: "School pickup",
            when: "",
            location: "",
            assignee: me.id,
            note: "",
          },
    );
    setForm(item ? "edit" : "add");
    setFormVersion(item?.version || 0);
    setFormKey(key());
    setError("");
    setNotice("");
    setConfirm(null);
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const time = new Date(draft.when);
      if (!Number.isFinite(time.getTime()))
        throw Error("Choose a valid pickup date and time.");
      if (localInput(time.toISOString()) !== draft.when)
        throw Error(
          "That time doesn’t exist in your time zone because the clocks change. Choose another time.",
        );
      const r = await fetch(
        "/api/pickups" + (form === "edit" && selected ? "/" + selected.id : ""),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...draft,
            scheduled_at: time.toISOString(),
            action: "edit",
            version: formVersion,
            key: formKey,
          }),
        },
      );
      const body = await r.json();
      if (!r.ok) {
        if (r.status === 409 && selected) await loadDetail(selected.id);
        throw Error(body.error);
      }
      setSelected(body);
      setForm(null);
      setPast(false);
      setNotice(
        form === "edit"
          ? "Pickup updated for both parents."
          : "Pickup added for both parents.",
      );
      await refresh();
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
  async function finish() {
    if (!selected || !confirm || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/pickups/" + selected.id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirm),
      });
      const body = await r.json();
      if (!r.ok) {
        if (r.status === 409) await loadDetail(selected.id);
        throw Error(body.error);
      }
      setSelected(body);
      setConfirm(null);
      setNotice(
        body.status === "completed"
          ? "Picked up. Saved in Past pickups."
          : "Pickup cancelled. Saved in Past pickups.",
      );
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. It is safe to retry.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stale =
    form === "edit" &&
    selected &&
    (selected.version !== formVersion || selected.status !== "scheduled");
  const list = items.filter((p) =>
    past ? p.status !== "scheduled" : p.status === "scheduled",
  );
  if (past) list.reverse();
  return (
    <div className="pickup-planner">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {syncError && (
        <p role="status" className="error">
          {syncError}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {form ? (
        <>
          <button
            className="text back"
            disabled={busy}
            onClick={() => {
              setForm(null);
              setError("");
            }}
          >
            ← Back to {selected ? "pickup" : "pickups"}
          </button>
          <h1>{form === "add" ? "Add pickup" : "Edit pickup"}</h1>
          <p>Choose who’s picking up, when, and where.</p>
          {stale && (
            <div className="note" role="status">
              <strong>This pickup changed while you were editing.</strong>
              <p>
                Latest: {selected.title} · {when(selected.scheduled_at)} ·{" "}
                {selected.location} · {selected.assignee_name} ·{" "}
                {label(selected)}
              </p>
              {selected.note && <p>{selected.note}</p>}
              <p>Your draft is still below.</p>
              {selected.status === "scheduled" && (
                <button className="text" onClick={() => begin(selected)}>
                  Discard my draft and load latest details
                </button>
              )}
            </div>
          )}
          <form onSubmit={submit}>
            <label>
              Pickup title
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                maxLength={160}
                required
              />
            </label>
            <label>
              Date and time
              <input
                type="datetime-local"
                value={draft.when}
                onChange={(e) => setDraft({ ...draft, when: e.target.value })}
                required
              />
            </label>
            <p className="muted">
              Enter your local time ({zone}). Both parents see the same moment
              in their own time zone.
            </p>
            <label>
              Pickup location
              <input
                value={draft.location}
                onChange={(e) =>
                  setDraft({ ...draft, location: e.target.value })
                }
                maxLength={200}
                required
                placeholder="e.g. Willow Primary, front gate"
              />
            </label>
            <label>
              Who’s picking up?
              <select
                value={draft.assignee}
                onChange={(e) =>
                  setDraft({ ...draft, assignee: e.target.value })
                }
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pickup note <span className="muted">(optional)</span>
              <textarea
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                maxLength={500}
                placeholder="e.g. Bring the blue folder"
              />
            </label>
            <button disabled={busy || !!stale}>
              {busy
                ? "Saving…"
                : form === "add"
                  ? "Add pickup"
                  : "Save changes"}
            </button>
          </form>
        </>
      ) : selected ? (
        <>
          <button
            className="text back"
            onClick={() => {
              setSelected(null);
              setConfirm(null);
              setError("");
              setNotice("");
            }}
          >
            ← Back to pickups
          </button>
          <span className={"badge " + selected.status}>{label(selected)}</span>
          <h1>{selected.title}</h1>
          <p className="pickup-time">{when(selected.scheduled_at)}</p>
          <p className="muted">Times shown in {zone}</p>
          <dl className="pickup-facts">
            <dt>Where</dt>
            <dd>{selected.location}</dd>
            <dt>Picking up</dt>
            <dd>{selected.assignee_name}</dd>
          </dl>
          {selected.note && (
            <div className="note">
              <small>PICKUP NOTE</small>
              <p>{selected.note}</p>
            </div>
          )}
          {selected.status === "scheduled" && (
            <section>
              <h2>Manage this pickup</h2>
              {confirm ? (
                <div className="pickup-confirm">
                  <p>
                    {confirm.action === "complete"
                      ? "Confirm that the pickup happened."
                      : "Cancel this planned pickup? Both parents will see the cancellation."}
                  </p>
                  {confirm.version !== selected.version && (
                    <p role="status">
                      This pickup changed. Go back and review the latest
                      details.
                    </p>
                  )}
                  <button
                    disabled={busy || confirm.version !== selected.version}
                    onClick={finish}
                  >
                    {busy
                      ? "Saving…"
                      : confirm.action === "complete"
                        ? "Confirm picked up"
                        : "Confirm cancellation"}
                  </button>
                  <button
                    className="text"
                    disabled={busy}
                    onClick={() => {
                      setConfirm(null);
                      setError("");
                    }}
                  >
                    Go back
                  </button>
                </div>
              ) : (
                <div className="pickup-actions">
                  <button
                    onClick={() =>
                      setConfirm({
                        action: "complete",
                        version: selected.version,
                        key: key(),
                      })
                    }
                  >
                    Mark picked up
                  </button>
                  <button className="secondary" onClick={() => begin(selected)}>
                    Edit pickup
                  </button>
                  <button
                    className="text danger"
                    onClick={() =>
                      setConfirm({
                        action: "cancel",
                        version: selected.version,
                        key: key(),
                      })
                    }
                  >
                    Cancel pickup
                  </button>
                </div>
              )}
            </section>
          )}
          <section>
            <h2>Pickup activity</h2>
            <ol className="timeline">
              {selected.events.map((e) => (
                <li key={e.id}>
                  <strong>
                    {e.action === "created"
                      ? "Added"
                      : e.action === "edited"
                        ? "Updated"
                        : e.action === "completed"
                          ? "Picked up"
                          : "Cancelled"}{" "}
                    by {e.actor}
                  </strong>
                  <time dateTime={e.at}>{displayDateTime(e.at)}</time>
                  <p>
                    {when(e.snapshot.scheduled_at)} · {e.snapshot.location}
                    <br />
                    {e.snapshot.assignee_name} picking up
                  </p>
                  {e.snapshot.note && <p>{e.snapshot.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <>
          <div className="heading">
            <h1>Pickups</h1>
            <span className="count">
              {items.filter((p) => p.status === "scheduled").length} planned
            </span>
          </div>
          <p className="intro">A clear plan for the next handoff.</p>
          <button
            onClick={() => {
              setSelected(null);
              begin();
            }}
          >
            ＋ Add pickup
          </button>
          <div
            className="pickup-filters"
            role="group"
            aria-label="Pickup lists"
          >
            <button
              aria-pressed={!past}
              className={!past ? "active" : "text"}
              onClick={() => setPast(false)}
            >
              Upcoming
            </button>
            <button
              aria-pressed={past}
              className={past ? "active" : "text"}
              onClick={() => setPast(true)}
            >
              Past pickups
            </button>
          </div>
          <p className="muted">
            Times shown in {zone}.{" "}
            {past
              ? "Completed and cancelled pickups stay here."
              : "Earliest first. Past pickup times stay here until checked off or cancelled."}
          </p>
          {loading ? (
            <p>Loading pickups…</p>
          ) : list.length === 0 ? (
            <section className="empty">
              <h2>{past ? "No past pickups yet" : "No pickups planned yet"}</h2>
              <p>
                {past
                  ? "Completed and cancelled pickups will stay here with their activity."
                  : "Add a school pickup or a handoff between homes. Both parents will see the plan."}
              </p>
            </section>
          ) : (
            <div className="cards">
              {list.map((p) => (
                <button
                  className="card"
                  key={p.id}
                  onClick={async () => {
                    setError("");
                    setNotice("");
                    try {
                      await loadDetail(p.id);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not open pickup.",
                      );
                    }
                  }}
                >
                  <div className="cardtop">
                    <span className={"badge " + p.status}>{label(p)}</span>
                    <span aria-hidden="true">&gt;</span>
                  </div>
                  <h2>{p.title}</h2>
                  <p className="pickup-time">{when(p.scheduled_at)}</p>
                  <p>{p.location}</p>
                  <div className="cardbottom">
                    <strong>{p.assignee_name} is picking up</strong>
                  </div>
                  {p.note && <p className="cardnote">{p.note}</p>}
                </button>
              ))}
            </div>
          )}
          <footer>Shared with your household · syncs every 3 seconds</footer>
        </>
      )}
    </div>
  );
}
