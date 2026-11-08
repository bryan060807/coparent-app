"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import PickupPlanner, { NextPickup } from "./pickups";
import HomeworkPlanner, { HomeworkToday } from "./homework";
import FamilySection, { RoutineSummary } from "./family";
import { Brand, Icon, EmptyMark } from "./ui";
import AuthScreen from "./auth";
import TeamSettings from "./team";
import HubPanel, {
  ChildSpace,
  ParentAppearance,
  hubSections,
  type HubSection,
} from "./hub";
import { APP_NAME, type Team } from "../lib/team-types";
import { uploadSchoolPaper } from "../lib/cloud/upload";
type Member = { id: string; name: string; role?: "parent" | "child" };
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
  const authRequest = useRef(0);
  const account = useRef<string | null>(null);
  const uploaded = useRef<string | null>(null);
  const [me, setMe] = useState<Member | null>(null),
    [team, setTeam] = useState<Team | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [loading, setLoading] = useState(true),
    [onboarding, setOnboarding] = useState(false),
    [directUploads, setDirectUploads] = useState(false),
    [papers, setPapers] = useState<Paper[]>([]),
    [view, setView] = useState<
      | "today"
      | "history"
      | "add"
      | "pickups"
      | "homework"
      | "gifts"
      | "routines"
      | "info"
      | "team"
      | HubSection
    >("today"),
    [homeworkId, setHomeworkId] = useState<string | undefined>(),
    [moreOpen, setMoreOpen] = useState(false),
    [selected, setSelected] = useState<Paper | null>(null),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [key, setKey] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    // Sticky navigation stays reachable on long lists; open the next view at its top.
    window.scrollTo(0, 0);
  }, [view, selected?.id, homeworkId, me?.id]);
  useEffect(() => {
    document.title = `${me && team ? team.name : APP_NAME} · Family handoffs`;
  }, [team?.name, me?.id]);
  const refresh = useCallback(async () => {
    const request = ++authRequest.current;
    try {
      const r = await fetch("/api/me");
      if (request !== authRequest.current) return;
      if (r.status === 401) {
        account.current = null;
        setMe(null);
        setTeam(null);
        setOnboarding(false);
        setSelected(null);
        setPapers([]);
        setLoading(false);
        return;
      }
      if (!r.ok) throw Error();
      const m = await r.json();
      if (request !== authRequest.current) return;
      if (m.onboardingRequired) {
        account.current = null;
        setMe(null);
        setTeam(null);
        setSelected(null);
        setPapers([]);
        setMembers([]);
        setOnboarding(true);
        setLoading(false);
        return;
      }
      // A login in another tab can replace the cookie without an intervening
      // 401. Clear the previous account's screen before showing the new user.
      if (account.current !== m.user.id) {
        account.current = m.user.id;
        setSelected(null);
        setPapers([]);
        setView("today");
        setHomeworkId(undefined);
        setMoreOpen(false);
        setNotice("");
        setError("");
      }
      setMe(m.user);
      setOnboarding(false);
      setDirectUploads(m.uploads === "direct");
      setTeam(m.team);
      setMembers(m.members);
      if (m.user.role === "child") {
        setPapers([]);
        setSyncError("");
        setLoading(false);
        return;
      }
      const p = await fetch("/api/papers");
      if (!p.ok) throw Error();
      const latestPapers = await p.json();
      if (request !== authRequest.current) return;
      setPapers(latestPapers);
      setSyncError("");
      setLoading(false);
    } catch {
      if (request !== authRequest.current) return;
      setSyncError("Could not sync. Check your connection; we’ll retry.");
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const i = setInterval(() => void refresh(), 3000);
    const changed = () => void refresh();
    window.addEventListener("team-account-change", changed);
    return () => {
      clearInterval(i);
      window.removeEventListener("team-account-change", changed);
    };
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const id = selected.id;
    const owner = account.current;
    const update = async () => {
      try {
        const r = await fetch("/api/papers/" + id);
        if (r.ok) {
          const latest = await r.json();
          if (live && account.current === owner) setSelected(latest);
        }
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
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    f.set("key", key);
    try {
      let r: Response;
      if (directUploads) {
        const file = f.get("file");
        if (!(file instanceof File))
          throw Error("Choose a photo or PDF first.");
        if (!uploaded.current) uploaded.current = await uploadSchoolPaper(file);
        r = await fetch("/api/papers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: f.get("title"),
            due: f.get("due"),
            assignee: f.get("assignee"),
            key,
            uploadId: uploaded.current,
          }),
        });
        if (r.status === 400 || r.status === 404) uploaded.current = null;
      } else r = await fetch("/api/papers", { method: "POST", body: f });
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
    const owner = account.current;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/papers/" + selected.id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const b = await r.json();
      if (account.current !== owner) return;
      const latest = await fetch("/api/papers/" + selected.id);
      if (latest.ok) {
        const paper = await latest.json();
        if (account.current !== owner) return;
        setSelected(paper);
      }
      await refresh();
      if (account.current !== owner) return;
      if (!r.ok) throw Error(b.error);
      setNote("");
      setNotice(
        status === "signed"
          ? "Signed. It still needs to go back to school."
          : "Returned. This paper is saved in History.",
      );
    } catch (e) {
      if (account.current !== owner) return;
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
      <AuthScreen
        key={onboarding ? "onboarding" : "auth"}
        onboarding={onboarding}
        onAuthenticated={refresh}
      />
    );
  if (me.role === "child")
    return (
      <ChildSpace
        key={me.id}
        user={me}
        team={team?.name ?? "Your team"}
        onSignedOut={refresh}
      />
    );
  const list = papers.filter((p) =>
    view === "history" ? p.status === "returned" : p.status !== "returned",
  );
  return (
    <main>
      <ParentAppearance key={me.id} viewer={me.id} />
      <header>
        <Brand name={team?.name} />
        <button
          className="text signout"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await fetch("/api/logout", { method: "POST" });
              if (!r.ok && r.status !== 401) throw Error();
              ++authRequest.current;
              account.current = null;
              setMe(null);
              setTeam(null);
              setOnboarding(false);
              setSelected(null);
              setPapers([]);
              setMembers([]);
              setHomeworkId(undefined);
              setMoreOpen(false);
              setView("today");
              setError("");
              setSyncError("");
              setNotice("");
            } catch {
              setError(
                "Could not sign out. Check your connection and try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="logout" />
          <span>Sign out</span>
        </button>
      </header>
      <p className="eyebrow">Hi, {me.name.split(" ")[0]} · YOUR HOUSEHOLD</p>
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
            <Icon name="paper" /> Open original attachment
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
          <div className="app-navigation">
            <nav aria-label="Household" className="household-nav">
              <button
                className={view === "today" ? "active" : "text"}
                onClick={() => {
                  setView("today");
                  setMoreOpen(false);
                  setError("");
                }}
              >
                <Icon name="today" />
                <span>Today</span>
              </button>
              <button
                className={view === "pickups" ? "active" : "text"}
                onClick={() => {
                  setView("pickups");
                  setMoreOpen(false);
                  setError("");
                  setNotice("");
                }}
              >
                <Icon name="pickups" />
                <span>Pickups</span>
              </button>
              <button
                className={view === "homework" ? "active" : "text"}
                onClick={() => {
                  setView("homework");
                  setMoreOpen(false);
                  setHomeworkId(undefined);
                  setError("");
                  setNotice("");
                }}
              >
                <Icon name="homework" />
                <span>Homework</span>
              </button>
              <button
                className={
                  moreOpen ||
                  [
                    "history",
                    "gifts",
                    "routines",
                    "info",
                    "team",
                    ...hubSections.map((s) => s.id),
                  ].includes(view)
                    ? "active"
                    : "text"
                }
                aria-expanded={moreOpen}
                aria-controls="more-sections"
                onClick={() => setMoreOpen(!moreOpen)}
              >
                <Icon name="more" />
                <span>More</span>
              </button>
            </nav>
            {moreOpen && (
              <nav
                id="more-sections"
                aria-label="More sections"
                className="more-sections"
              >
                {hubSections.map((link) => (
                  <button
                    className={view === link.id ? "active" : "secondary"}
                    key={link.id}
                    onClick={() => {
                      setView(link.id);
                      setMoreOpen(false);
                      setError("");
                      setNotice("");
                    }}
                  >
                    <span aria-hidden="true">{link.emoji}</span>
                    <span>{link.label}</span>
                  </button>
                ))}
                {(
                  [
                    { view: "gifts", label: "Gifts & money" },
                    { view: "routines", label: "Routines & chores" },
                    { view: "info", label: "Health & personal info" },
                    { view: "history", label: "Paper history" },
                    { view: "team", label: "Your team" },
                  ] as const
                ).map((link) => (
                  <button
                    className={view === link.view ? "active" : "secondary"}
                    key={link.view}
                    onClick={() => {
                      setView(link.view);
                      setMoreOpen(false);
                      setError("");
                      setNotice("");
                    }}
                  >
                    <Icon name={link.view} />
                    <span>{link.label}</span>
                  </button>
                ))}
              </nav>
            )}
          </div>
          {hubSections.some((s) => s.id === view) ? (
            <HubPanel
              key={me.id + ":" + view}
              section={view as HubSection}
              viewer={me.id}
            />
          ) : view === "team" && team ? (
            <TeamSettings
              key={"team:" + me.id}
              team={team}
              members={members}
              onSaved={(next) => {
                if (account.current !== me.id) return;
                ++authRequest.current;
                setTeam(next);
              }}
            />
          ) : view === "gifts" || view === "routines" || view === "info" ? (
            <FamilySection
              key={me.id + ":" + view}
              kind={view}
              members={members}
            />
          ) : view === "homework" ? (
            <HomeworkPlanner
              key={"homework-planner:" + me.id + ":" + (homeworkId ?? "list")}
              initialId={homeworkId}
            />
          ) : view === "pickups" ? (
            <PickupPlanner
              key={"pickup-planner:" + me.id}
              members={members}
              me={me}
            />
          ) : view === "add" ? (
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
                    disabled={busy}
                    onChange={() => {
                      uploaded.current = null;
                    }}
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
              {view === "today" && (
                <p className="section-kicker">Your daily mise en place</p>
              )}
              <div className="heading">
                <h1>{view === "today" ? "Today" : "History"}</h1>
                <span className="count">
                  {list.length}{" "}
                  {view === "history"
                    ? "returned"
                    : list.length === 1
                      ? "paper"
                      : "papers"}
                </span>
              </div>
              <p className="intro">
                {view === "today"
                  ? "A little preparation. A smoother handoff. Due soonest comes first."
                  : "Returned to school. Kept here for peace of mind."}
              </p>
              {view === "today" && members.length === 1 && (
                <div className="team-welcome">
                  <p>
                    <strong>Welcome to {team?.name}.</strong> Bring the other
                    parent onto your team so you can share the details.
                  </p>
                  <button className="secondary" onClick={() => setView("team")}>
                    Invite the other parent
                  </button>
                </div>
              )}
              {view === "today" && (
                <button
                  onClick={() => {
                    setView("add");
                    uploaded.current = null;
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
                  <Icon name="paper" /> Add school paper
                </button>
              )}
              {view === "today" && (
                <NextPickup
                  key={"pickup-summary:" + me.id}
                  onOpen={() => {
                    setView("pickups");
                    setNotice("");
                  }}
                />
              )}
              {view === "today" && (
                <HomeworkToday
                  key={"homework-summary:" + me.id}
                  onOpen={(id) => {
                    setHomeworkId(id);
                    setView("homework");
                    setNotice("");
                  }}
                />
              )}
              {view === "today" && (
                <RoutineSummary
                  key={"routine-summary:" + me.id}
                  onOpen={() => {
                    setView("routines");
                    setNotice("");
                  }}
                />
              )}
              {list.length === 0 ? (
                <section className="empty">
                  <EmptyMark />
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
                        const owner = me.id;
                        setError("");
                        setNotice("");
                        try {
                          const r = await fetch("/api/papers/" + p.id);
                          if (!r.ok) throw Error();
                          const paper = await r.json();
                          if (account.current !== owner) return;
                          setSelected(paper);
                          setNote("");
                        } catch {
                          if (account.current !== owner) return;
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
