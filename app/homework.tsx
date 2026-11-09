"use client";
import { displayDateTime, clockOptions } from "../lib/appearance";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Homework,
  HomeworkDetail,
  HomeworkEvent,
} from "../lib/homework-types";
const requestKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const date = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const label = (status: Homework["status"]) =>
  status === "not_started"
    ? "Not started"
    : status === "in_progress"
      ? "In progress"
      : "Done";
const eventLabel: Record<HomeworkEvent["action"], string> = {
  created: "Added",
  edited: "Updated",
  noted: "Note saved",
  started: "Started",
  done: "Done",
};
function useHomework() {
  const [items, setItems] = useState<Homework[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/homework");
      if (!r.ok) throw Error();
      setItems(await r.json());
      setError("");
    } catch {
      setError("Could not sync homework. Check your connection; we’ll retry.");
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
export function HomeworkToday({ onOpen }: { onOpen: (id?: string) => void }) {
  const { items, loading, error } = useHomework();
  const active = items.filter((item) => item.status !== "done");
  return (
    <section className="homework-summary" aria-label="Homework to do">
      <div className="cardtop">
        <h2>Homework to do</h2>
        <button className="text" onClick={() => onOpen()}>
          View homework
        </button>
      </div>
      {loading ? (
        <p>Loading homework…</p>
      ) : error ? (
        <p role="status">{error}</p>
      ) : active.length === 0 ? (
        <p>No unfinished homework. Add an assignment when it comes home.</p>
      ) : (
        <div className="homework-mini-list">
          {active.map((item) => (
            <button
              key={item.id}
              className="homework-mini"
              onClick={() => onOpen(item.id)}
            >
              <strong>{item.title}</strong>
              <span className={item.due < today() ? "overdue" : ""}>
                {item.due < today() ? "Overdue · " : ""}Due {date(item.due)} ·{" "}
                {label(item.status)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
type Draft = { title: string; due: string; note: string };
export default function HomeworkPlanner({ initialId }: { initialId?: string }) {
  const { items, loading, error: syncError, refresh } = useHomework();
  const [selected, setSelected] = useState<HomeworkDetail | null>(null),
    [form, setForm] = useState<"add" | "edit" | null>(null),
    [draft, setDraft] = useState<Draft>({ title: "", due: today(), note: "" }),
    [formVersion, setFormVersion] = useState(0),
    [formKey, setFormKey] = useState(""),
    [completed, setCompleted] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState({ value: "", base: "", version: 0 });
  const saving = useRef(false),
    lastRequest = useRef({ signature: "", key: "" });
  const fetchDetail = useCallback(async (id: string) => {
    const r = await fetch("/api/homework/" + id);
    if (!r.ok) throw Error("Could not open this assignment. Please try again.");
    return (await r.json()) as HomeworkDetail;
  }, []);
  function apply(item: HomeworkDetail) {
    setSelected(item);
    setNote({ value: item.note, base: item.note, version: item.version });
  }
  useEffect(() => {
    if (!initialId) return;
    let live = true;
    void fetchDetail(initialId)
      .then((item) => {
        if (live) apply(item);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [initialId, fetchDetail]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const id = selected.id;
    const update = async () => {
      try {
        const item = await fetchDetail(id);
        if (live)
          setSelected((old) =>
            !old || old.id !== item.id || item.version >= old.version
              ? item
              : old,
          );
      } catch {
        /* list refresh reports connectivity; next poll retries */
      }
    };
    const timer = setInterval(update, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selected?.id, fetchDetail]);
  useEffect(() => {
    if (selected)
      setNote((old) =>
        old.value === old.base
          ? {
              value: selected.note,
              base: selected.note,
              version: selected.version,
            }
          : old,
      );
  }, [selected?.version, selected?.id]);
  function begin(item?: HomeworkDetail) {
    setDraft(
      item
        ? { title: item.title, due: item.due, note: item.note }
        : { title: "", due: today(), note: "" },
    );
    setForm(item ? "edit" : "add");
    setFormVersion(item?.version || 0);
    setFormKey(requestKey());
    setError("");
    setNotice("");
  }
  async function send(body: object, id?: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/homework" + (id ? "/" + id : ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 409 && id) setSelected(await fetchDetail(id));
        throw Error(data.error);
      }
      return data as HomeworkDetail;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your draft is kept; it is safe to retry.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const item = await send(
      { ...draft, action: "edit", version: formVersion, key: formKey },
      form === "edit" ? selected?.id : undefined,
    );
    if (item) {
      apply(item);
      setForm(null);
      setCompleted(false);
      setNotice(
        form === "edit"
          ? "Assignment updated for both parents."
          : "Assignment added for both parents.",
      );
      await refresh();
    }
  }
  async function advance(action: "start" | "done" | "note") {
    if (!selected) return;
    const body = { action, note: note.value, version: note.version };
    const signature = JSON.stringify({ id: selected.id, ...body });
    if (lastRequest.current.signature !== signature)
      lastRequest.current = { signature, key: requestKey() };
    const item = await send(
      { ...body, key: lastRequest.current.key },
      selected.id,
    );
    if (item) {
      apply(item);
      setNotice(
        action === "done"
          ? "Done. Saved in Completed homework."
          : action === "start"
            ? "Homework is now in progress."
            : "Handoff note saved for both parents.",
      );
      await refresh();
    }
  }
  const staleForm = !!(
    form === "edit" &&
    selected &&
    (selected.version !== formVersion || selected.status === "done")
  );
  const staleNote = !!(selected && note.version !== selected.version);
  const list = items.filter((item) =>
    completed ? item.status === "done" : item.status !== "done",
  );
  if (completed) list.reverse();
  return (
    <div className="homework-planner">
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
            ← Back to {selected ? "assignment" : "homework"}
          </button>
          <h1>{form === "add" ? "Add homework" : "Edit homework"}</h1>
          <p>A small, clear task to share between homes.</p>
          {staleForm && (
            <div className="note" role="status">
              <strong>This assignment changed while you were editing.</strong>
              <p>
                Latest: {selected?.title} · Due {selected && date(selected.due)}{" "}
                · {selected && label(selected.status)}
              </p>
              {selected?.note && <p>{selected.note}</p>}
              <p>Your draft is kept below.</p>
              {selected?.status !== "done" && (
                <button
                  className="text"
                  onClick={() => selected && begin(selected)}
                >
                  Discard my draft and load latest details
                </button>
              )}
            </div>
          )}
          <form onSubmit={save}>
            <label>
              Assignment title
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Reading and math sheet"
              />
            </label>
            <label>
              Homework due date
              <input
                required
                type="date"
                value={draft.due}
                onChange={(e) => setDraft({ ...draft, due: e.target.value })}
              />
            </label>
            <label>
              Handoff note <span className="muted">(optional)</span>
              <textarea
                maxLength={500}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="e.g. Math sheet is in the blue folder"
              />
            </label>
            <button disabled={busy || staleForm}>
              {busy
                ? "Saving…"
                : form === "add"
                  ? "Add assignment"
                  : "Save assignment"}
            </button>
          </form>
        </>
      ) : selected ? (
        <>
          <button
            className="text back"
            onClick={() => {
              setSelected(null);
              setError("");
              setNotice("");
            }}
          >
            ← Back to homework
          </button>
          <span className={"badge " + selected.status}>
            {label(selected.status)}
          </span>
          <h1>{selected.title}</h1>
          <p
            className={
              selected.status !== "done" && selected.due < today()
                ? "overdue"
                : ""
            }
          >
            {selected.status !== "done" && selected.due < today()
              ? "Overdue · "
              : ""}
            Due {date(selected.due)}
          </p>
          {selected.status === "done" ? (
            <>
              <div className="note">
                <strong>Homework finished</strong>
                <p>
                  {selected.note ||
                    "This assignment is saved in Completed homework."}
                </p>
              </div>
              {note.value !== note.base && (
                <div className="note" role="status">
                  <strong>Your unsaved note</strong>
                  <p>
                    The other session marked this assignment done. Your draft is
                    kept here so you can copy it.
                  </p>
                  <p>{note.value}</p>
                </div>
              )}
            </>
          ) : (
            <section>
              <h2>
                {selected.status === "not_started"
                  ? "Next: start the assignment"
                  : "Next: finish the assignment"}
              </h2>
              <p>Leave a note so the other home knows what’s left.</p>
              {staleNote && (
                <div className="note" role="status">
                  <strong>
                    This assignment changed while you were writing.
                  </strong>
                  <p>Latest note: {selected.note || "No note yet."}</p>
                  <p>Your draft is kept below.</p>
                  <button
                    className="text"
                    onClick={() =>
                      setNote({
                        value: selected.note,
                        base: selected.note,
                        version: selected.version,
                      })
                    }
                  >
                    Replace my draft with the latest note
                  </button>
                </div>
              )}
              <label>
                Handoff note
                <textarea
                  maxLength={500}
                  value={note.value}
                  onChange={(e) => setNote({ ...note, value: e.target.value })}
                  placeholder="Reading finished; math sheet is in the blue folder."
                />
              </label>
              <div className="homework-actions">
                <button
                  disabled={busy || staleNote}
                  onClick={() =>
                    advance(
                      selected.status === "not_started" ? "start" : "done",
                    )
                  }
                >
                  {busy
                    ? "Saving…"
                    : selected.status === "not_started"
                      ? "Start homework"
                      : "Mark done"}
                </button>
                <button
                  className="secondary"
                  disabled={busy || staleNote || note.value === note.base}
                  onClick={() => advance("note")}
                >
                  Save handoff note
                </button>
                <button
                  className="text"
                  disabled={busy}
                  onClick={() => begin(selected)}
                >
                  Edit assignment
                </button>
              </div>
            </section>
          )}
          <section>
            <h2>Homework activity</h2>
            <ol className="timeline">
              {selected.events.map((event) => (
                <li key={event.id}>
                  <strong>
                    {eventLabel[event.action]} by {event.actor}
                  </strong>
                  <time dateTime={event.at}>{displayDateTime(event.at)}</time>
                  {event.action === "created" || event.action === "edited" ? (
                    <p>
                      {event.snapshot.title} · Due {date(event.snapshot.due)}
                    </p>
                  ) : null}
                  <p>
                    {label(event.snapshot.status)}
                    {event.snapshot.note ? " · " + event.snapshot.note : ""}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <>
          <div className="heading">
            <h1>Homework</h1>
            <span className="count">
              {items.filter((item) => item.status !== "done").length} to do
            </span>
          </div>
          <p className="intro">A little progress, shared between both homes.</p>
          <button onClick={() => begin()}>＋ Add homework</button>
          <div
            className="homework-filters"
            role="group"
            aria-label="Homework lists"
          >
            <button
              aria-pressed={!completed}
              className={!completed ? "active" : "text"}
              onClick={() => setCompleted(false)}
            >
              To do
            </button>
            <button
              aria-pressed={completed}
              className={completed ? "active" : "text"}
              onClick={() => setCompleted(true)}
            >
              Completed homework
            </button>
          </div>
          <p className="muted">
            {completed
              ? "Finished assignments stay here with their notes and activity."
              : "Overdue and soonest-due assignments come first."}
          </p>
          {loading ? (
            <p>Loading homework…</p>
          ) : syncError && items.length === 0 ? (
            <p>Assignments will appear once the connection is restored.</p>
          ) : list.length === 0 ? (
            <section className="empty">
              <h2>
                {completed ? "No completed homework yet" : "No homework to do"}
              </h2>
              <p>
                {completed
                  ? "Finished assignments will stay here."
                  : "Add the next assignment and both parents can help keep it moving."}
              </p>
            </section>
          ) : (
            <div className="cards">
              {list.map((item) => (
                <button
                  key={item.id}
                  className="card"
                  onClick={async () => {
                    setError("");
                    setNotice("");
                    try {
                      apply(await fetchDetail(item.id));
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not open assignment.",
                      );
                    }
                  }}
                >
                  <div className="cardtop">
                    <span className={"badge " + item.status}>
                      {label(item.status)}
                    </span>
                    <span aria-hidden="true">&gt;</span>
                  </div>
                  <h2>{item.title}</h2>
                  <p
                    className={
                      item.status !== "done" && item.due < today()
                        ? "overdue"
                        : ""
                    }
                  >
                    {item.status !== "done" && item.due < today()
                      ? "Overdue · "
                      : ""}
                    Due {date(item.due)}
                  </p>
                  {item.note && <p className="cardnote">{item.note}</p>}
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
