"use client";
import { useEffect, useState, useCallback } from "react";
type Member = { id: string; name: string };
type Paper = {
  id: string;
  title: string;
  due: string;
  status: string;
  note: string;
  assignee: string;
  assignee_name: string;
  events?: { action: string; note: string; at: string; actor: string }[];
};
const statusLabel = (s: string) =>
  s === "added"
    ? "Needs a signature"
    : s === "signed"
      ? "Signed · return to school"
      : "Returned to school";
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const date = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export default function Home() {
  const [me, setMe] = useState<Member | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [loading, setLoading] = useState(true),
    [papers, setPapers] = useState<Paper[]>([]),
    [view, setView] = useState<"today" | "history" | "add">("today"),
    [selected, setSelected] = useState<Paper | null>(null),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [key, setKey] = useState(""),
    [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/me");
      if (r.status === 401) {
        setMe(null);
        setSelected(null);
        setPapers([]);
        setLoading(false);
        return;
      }
      if (!r.ok) throw Error();
      const m = await r.json();
      setMe(m.user);
      setMembers(m.members);
      const p = await fetch("/api/papers");
      if (!p.ok) throw Error();
      setPapers(await p.json());
      setSyncError("");
      setLoading(false);
    } catch {
      setSyncError("Could not sync. Check your connection; we’ll retry.");
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const i = setInterval(() => void refresh(), 3000);
    return () => clearInterval(i);
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const id = selected.id;
    const update = async () => {
      try {
        const r = await fetch("/api/papers/" + id);
        if (r.ok && live) setSelected(await r.json());
      } catch {
        /* next polling cycle retries */
      }
    };
    void update();
    const i = setInterval(update, 3000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, [selected?.id]);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(f)),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    f.set("key", key);
    try {
      const r = await fetch("/api/papers", { method: "POST", body: f });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      await refresh();
      setView("today");
      setNotice("Paper added. Both parents can see it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function advance(status: string) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/papers/" + selected.id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const b = await r.json();
      const latest = await fetch("/api/papers/" + selected.id);
      if (latest.ok) setSelected(await latest.json());
      await refresh();
      if (!r.ok) throw Error(b.error);
      setNote("");
      setNotice(
        status === "signed"
          ? "Signed. It still needs to go back to school."
          : "Returned. This paper is saved in History.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Update failed. You can retry safely.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main>
        <p>Opening your household…</p>
      </main>
    );
  if (!me)
    return (
      <main className="login">
        <div className="brand">
          TWO HOMES <span> / one team</span>
        </div>
        <h1>
          Less to remember.
          <br />
          More shared.
        </h1>
        <p>
          School papers, from the backpack
          <br />
          back to school.
        </p>
        <form onSubmit={login}>
          <h2>Sign in</h2>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="muted">A private space for your household.</p>
      </main>
    );
  const list = papers.filter((p) =>
    view === "history" ? p.status === "returned" : p.status !== "returned",
  );
  return (
    <main>
      <header>
        <div className="brand">
          TWO HOMES <span> / one team</span>
        </div>
        <button
          className="text"
          onClick={async () => {
            await fetch("/api/logout", { method: "POST" });
            setMe(null);
            setSelected(null);
            setView("today");
            setError("");
            setNotice("");
          }}
        >
          Sign out
        </button>
      </header>
      <p className="eyebrow">Hi, {me.name.split(" ")[0]} · SCHOOL PAPERS</p>
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
      {selected ? (
        <>
          <button
            className="text back"
            onClick={() => {
              setSelected(null);
              setNote("");
              setError("");
            }}
          >
            ← Back to {view === "history" ? "History" : "Today"}
          </button>
          <span className={"badge " + selected.status}>
            {statusLabel(selected.status)}
          </span>
          <h1>{selected.title}</h1>
          <p>Due {date(selected.due)}</p>
          <p>
            Handling it:{" "}
            <strong>
              {members.find((m) => m.id === selected.assignee)?.name}
            </strong>
          </p>
          <a
            className="attachment"
            href={"/api/papers/" + selected.id + "/attachment"}
            target="_blank"
            rel="noreferrer"
          >
            ↗ Open original attachment
          </a>
          {selected.note && (
            <div className="note">
              <small>HANDOFF NOTE</small>
              <p>{selected.note}</p>
            </div>
          )}
          {selected.status !== "returned" && (
            <section>
              <h2>
                {selected.status === "added"
                  ? "Next: sign the paper"
                  : "Next: send it back to school"}
              </h2>
              <p>
                {selected.status === "added"
                  ? "Sign the original paper, then let your co-parent know."
                  : "Signed is not returned. Keep it here until it has gone back to school."}
              </p>
              <label>
                Handoff note <span className="muted">(optional)</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. In the blue folder"
                />
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  advance(selected.status === "added" ? "signed" : "returned")
                }
              >
                {busy
                  ? "Saving…"
                  : selected.status === "added"
                    ? "Mark Signed"
                    : "Mark Returned"}
              </button>
            </section>
          )}
          <section>
            <h2>Paper timeline</h2>
            <ol className="timeline">
              {selected.events?.map((e) => (
                <li key={e.action}>
                  <strong>
                    {e.action === "added"
                      ? "Added"
                      : e.action === "signed"
                        ? "Signed"
                        : "Returned"}{" "}
                    by {e.actor}
                  </strong>
                  <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>
                  {e.note && <p>{e.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <>
          <nav aria-label="School papers">
            <button
              className={view === "today" ? "active" : "text"}
              onClick={() => {
                setView("today");
                setError("");
              }}
            >
              Today
            </button>
            <button
              className={view === "history" ? "active" : "text"}
              onClick={() => {
                setView("history");
                setError("");
              }}
            >
              History
            </button>
          </nav>
          {view === "add" ? (
            <>
              <button className="text back" onClick={() => setView("today")}>
                ← Cancel
              </button>
              <h1>Add school paper</h1>
              <p>One paper. A clear next step for both homes.</p>
              <form onSubmit={add}>
                <label>
                  Paper title
                  <input
                    name="title"
                    required
                    maxLength={160}
                    placeholder="Field trip permission slip"
                  />
                </label>
                <label>
                  Due date
                  <input
                    name="due"
                    type="date"
                    required
                    defaultValue={today()}
                  />
                </label>
                <label>
                  Who’s handling it?
                  <select
                    name="assignee"
                    defaultValue={members.find((m) => m.id !== me.id)?.id}
                  >
                    {members.map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Photo or PDF
                  <input
                    name="file"
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    required
                  />
                </label>
                <p className="muted">
                  Take a photo or choose a file. JPEG, PNG or PDF, up to 10 MB.
                  On phones, the file picker offers your camera where supported.
                </p>
                <button disabled={busy}>
                  {busy ? "Uploading…" : "Add paper"}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="heading">
                <h1>{view === "today" ? "Today" : "History"}</h1>
                <span className="count">
                  {list.length} {view === "history" ? "returned" : "to do"}
                </span>
              </div>
              <p className="intro">
                {view === "today"
                  ? "A little clarity between two homes. Due soonest comes first."
                  : "Returned to school. Kept here for peace of mind."}
              </p>
              {view === "today" && (
                <button
                  onClick={() => {
                    setView("add");
                    setKey(
                      Array.from(
                        crypto.getRandomValues(new Uint8Array(16)),
                        (b) => b.toString(16).padStart(2, "0"),
                      ).join(""),
                    );
                    setError("");
                    setNotice("");
                  }}
                >
                  ＋ Add school paper
                </button>
              )}
              {list.length === 0 ? (
                <section className="empty">
                  <div className="folder">▱</div>
                  <h2>
                    {view === "history"
                      ? "No returned papers yet"
                      : "The backpack is clear"}
                  </h2>
                  <p>
                    {view === "history"
                      ? "Papers appear here once marked Returned."
                      : "Permission slips, forms, and school notes can all start here. Add your first paper and choose who’s handling it."}
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
                          const r = await fetch("/api/papers/" + p.id);
                          if (!r.ok) throw Error();
                          setSelected(await r.json());
                          setNote("");
                        } catch {
                          setError("Could not open this paper. Try again.");
                        }
                      }}
                    >
                      <div className="cardtop">
                        <span className={"badge " + p.status}>
                          {statusLabel(p.status)}
                        </span>
                        <span aria-hidden="true">&gt;</span>
                      </div>
                      <h2>{p.title}</h2>
                      <p
                        className={
                          p.status !== "returned" && p.due < today()
                            ? "overdue"
                            : ""
                        }
                      >
                        {p.status !== "returned" && p.due < today()
                          ? "Overdue · "
                          : ""}
                        Due {date(p.due)}
                      </p>
                      <div className="cardbottom">
                        <span>{p.assignee_name} is handling it</span>
                        <strong>
                          {p.status === "added"
                            ? "Next: sign"
                            : p.status === "signed"
                              ? "Next: return"
                              : "Complete"}
                        </strong>
                      </div>
                      {p.note && <p className="cardnote">“{p.note}”</p>}
                    </button>
                  ))}
                </div>
              )}
              <footer>
                Shared with your household · syncs every 3 seconds
              </footer>
            </>
          )}
        </>
      )}
    </main>
  );
}
