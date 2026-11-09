"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  consistencyQuestions,
  defaultAppearance,
  type HubView,
  type Appearance,
  type HubItem,
  type Exercise,
  type Resource,
  type Contact,
  type Goal,
  type Photo,
} from "../lib/hub-types";
import { Brand } from "./ui";
import AppSettings from "./settings";
import FinancePanel from "./finance";
import {
  applyAppearance,
  resetAppearance,
  displayTime,
} from "../lib/appearance";
import {
  LocationPanel,
  SharingStatus,
  FamilyLocationProvider,
} from "./location";
export type HubSection =
  | "gallery"
  | "resources"
  | "consistency"
  | "chat"
  | "contacts"
  | "rewards"
  | "profile"
  | "settings"
  | "location"
  | "finance";
export const hubSections: { id: HubSection; label: string; emoji: string }[] = [
  { id: "gallery", label: "Photo gallery", emoji: "▧" },
  { id: "resources", label: "Resources", emoji: "📚" },
  { id: "consistency", label: "Parenting together", emoji: "🤝" },
  { id: "chat", label: "Parent chat", emoji: "💬" },
  { id: "contacts", label: "Contacts", emoji: "☎" },
  { id: "rewards", label: "Stars & rewards", emoji: "⭐" },
  { id: "profile", label: "My profile", emoji: "🙂" },
  { id: "settings", label: "App settings", emoji: "🎨" },
  { id: "location", label: "Family map", emoji: "📍" },
  { id: "finance", label: "Family finances", emoji: "$" },
];
type Editing = { kind: string; item?: any };
const when = displayTime;
function useHub(viewer: string) {
  const [data, setData] = useState<HubView | null>(null),
    [error, setError] = useState(""),
    [allMessages, setAllMessages] = useState(false);
  const live = useRef(true);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    try {
      const r = await fetch("/api/hub" + (allMessages ? "?history=all" : ""), {
          cache: "no-store",
        }),
        b = await r.json();
      if (!live.current || ticket !== sequence.current) return;
      if (!r.ok) throw Error(b.error);
      if (b.viewer !== viewer) {
        setData(null);
        window.dispatchEvent(new Event("team-account-change"));
        return;
      }
      setData(b);
      setError("");
    } catch (e) {
      if (live.current && ticket === sequence.current)
        setError(
          e instanceof Error ? e.message : "Could not sync. We'll retry.",
        );
    }
  }, [viewer, allMessages]);
  useEffect(() => {
    live.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), 3000);
    return () => {
      live.current = false;
      clearInterval(id);
    };
  }, [refresh]);
  async function save(body: Record<string, unknown>) {
    const r = await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      b = await r.json();
    if (!r.ok) throw Object.assign(Error(b.error), { status: r.status });
    if (b.viewer !== viewer)
      throw Error("The signed-in account changed. Reload this page.");
    if (live.current) {
      ++sequence.current;
      setData(b);
      void refresh();
    }
    return b as HubView;
  }
  return {
    data,
    error,
    save,
    refresh,
    loadHistory: () => setAllMessages(true),
  };
}
export function ParentAppearance({
  viewer,
  onStartPage,
}: {
  viewer: string;
  onStartPage?: (page: string) => void;
}) {
  const started = useRef(false);
  const { data } = useHub(viewer);
  useEffect(() => {
    if (data) {
      applyAppearance(data.profile.appearance);
      if (!started.current) {
        started.current = true;
        onStartPage?.(data.profile.appearance.startPage ?? "today");
      }
    }
  }, [data]);
  useEffect(() => () => resetAppearance(), []);
  return null;
}
export function ChildLogin({
  onAuthenticated,
  onBack,
}: {
  onAuthenticated: () => Promise<void>;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="child-login">
      <Brand />
      <section className="child-welcome">
        <span className="big-star" aria-hidden="true">
          ✦
        </span>
        <h1>Your little corner of Team</h1>
        <p>
          See your stars, your wins, and the things your grownups saved for you.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const fields = Object.fromEntries(new FormData(e.currentTarget));
            setBusy(true);
            setError("");
            try {
              const r = await fetch("/api/child/login", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(fields),
                }),
                b = await r.json();
              if (!r.ok) throw Error(b.error);
              await onAuthenticated();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Child username
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              maxLength={40}
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={200}
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>{busy ? "Opening…" : "Let's go!"}</button>
        </form>
        <button className="text" onClick={onBack}>
          Parent sign in
        </button>
      </section>
    </main>
  );
}
function ResourceCards({ items }: { items: Resource[] }) {
  return (
    <div className="hub-stack">
      {items.map((r) => (
        <article className="hub-card" key={r.id}>
          <span className="hub-chip">
            {r.audience === "child" ? "For your child" : "For parents"}
          </span>
          <h2>{r.title}</h2>
          {r.details && <p className="preserve-lines">{r.details}</p>}
          {r.url && (
            <a
              className="attachment"
              href={r.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open resource ↗
            </a>
          )}
        </article>
      ))}
    </div>
  );
}
function ContactCards({
  items,
  edit,
}: {
  items: Contact[];
  edit?: (x: Contact) => void;
}) {
  return (
    <div className="hub-stack">
      {[...items]
        .sort(
          (a, b) =>
            Number(b.important) - Number(a.important) ||
            a.name.localeCompare(b.name),
        )
        .map((c) => (
          <article className="hub-card" key={c.id}>
            <span className="hub-chip">
              {c.important ? "★ Important · " : ""}
              {c.role || "Shared contact"}
            </span>
            <h2>{c.name}</h2>
            <div className="hub-actions">
              {c.phone && (
                <a
                  className="attachment"
                  href={"tel:" + c.phone.replace(/[\s().-]/g, "")}
                >
                  ☎ {c.phone}
                </a>
              )}
              {c.email && (
                <a className="attachment" href={"mailto:" + c.email}>
                  {c.email}
                </a>
              )}
            </div>
            {c.note && <p className="preserve-lines">{c.note}</p>}
            {edit && (
              <>
                <p className="muted">
                  {c.childVisible ? "Also in child view" : "Parents only"}
                </p>
                <button className="secondary" onClick={() => edit(c)}>
                  Edit contact
                </button>
              </>
            )}
          </article>
        ))}
    </div>
  );
}
function Gallery({
  photos,
  edit,
}: {
  photos: Photo[];
  edit?: (p: Photo) => void;
}) {
  return (
    <div className="photo-grid">
      {[...photos].reverse().map((p) => (
        <figure className="photo-tile" key={p.id}>
          <a href={"/api/hub/photos/" + p.id} target="_blank" rel="noreferrer">
            <img
              loading="lazy"
              src={"/api/hub/photos/" + p.id}
              alt={p.caption || "Shared family photo"}
            />
          </a>
          <figcaption>
            {p.caption || "A little moment worth keeping"}
            <small>
              {p.actor} · {when(p.at)}
            </small>
            {edit && (
              <>
                <small>
                  {p.childVisible ? "Also in child view" : "Parents only"}
                </small>
                <button className="text" onClick={() => edit(p)}>
                  Edit photo
                </button>
              </>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="hub-empty">
      <span aria-hidden="true">✧</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}
export default function HubPanel({
  section,
  viewer,
}: {
  section: HubSection;
  viewer: string;
}) {
  const hub = useHub(viewer),
    { data, error } = hub;
  const [editing, setEditing] = useState<Editing | null>(null),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [notice, setNotice] = useState("");
  const sendKey = useRef(crypto.randomUUID());
  const chatEnd = useRef<HTMLDivElement>(null);
  const followChat = useRef(true);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [editing?.kind, editing?.item?.id]);
  useEffect(() => {
    if (section === "chat" && followChat.current)
      chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [data?.messages.length, section]);
  async function action(
    op: string,
    item: HubItem,
    extra: Record<string, unknown> = {},
  ) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await hub.save({
        op,
        id: item.id,
        version: item.version,
        key: crypto.randomUUID(),
        ...extra,
      });
      setNotice("Saved for your team.");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (section === "finance") return <FinancePanel viewer={viewer} />;
  if (!data)
    return (
      <section>
        <h1>{hubSections.find((s) => s.id === section)?.label}</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Opening your shared space…"}
        </p>
      </section>
    );
  if (section === "settings")
    return <AppSettings data={data} save={hub.save} />;
  if (section === "location") return <LocationPanel />;
  const close = () => {
    setEditing(null);
    setNotice("Saved for your team.");
  };
  const open = (kind: string, item?: unknown) => {
    setNotice("");
    setActionError("");
    setEditing({ kind, item });
  };
  if (editing)
    return (
      <HubEditor
        editing={editing}
        data={data}
        viewer={viewer}
        save={hub.save}
        onDone={close}
        onCancel={() => setEditing(null)}
        onLatest={() => {
          const map: Record<string, unknown[]> = {
            photo: data.photos,
            resource: data.resources,
            contact: data.contacts,
            exercise: data.exercises,
            goal: data.goals,
          };
          const latest = map[editing.kind]?.find(
            (x: any) => x.id === editing.item?.id,
          );
          setEditing({ kind: editing.kind, item: latest ?? editing.item });
        }}
      />
    );
  return (
    <section className="hub-section">
      <p className="section-kicker">A little more, shared</p>
      <h1>{hubSections.find((s) => s.id === section)?.label}</h1>
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {section === "gallery" && (
        <>
          <p>
            The everyday moments between two homes. Photos stay private to your
            team.
          </p>
          <button onClick={() => open("photo")}>＋ Add photo</button>
          {!data.photos.length ? (
            <Empty title="Start with a little moment">
              Add a JPEG or PNG. Choose whether your child can see it too.
            </Empty>
          ) : (
            <Gallery photos={data.photos} edit={(p) => open("photo", p)} />
          )}
        </>
      )}
      {section === "resources" && (
        <>
          <p>
            Keep useful links and guidance together. Choose which resources
            belong in your child's space.
          </p>
          <button onClick={() => open("resource")}>＋ Add resource</button>
          {!data.resources.length ? (
            <Empty title="A shared shelf for useful things">
              Save a reading activity, a school link, or guidance you both want
              close by.
            </Empty>
          ) : (
            data.resources.map((r) => (
              <div key={r.id}>
                <ResourceCards items={[r]} />
                <button className="text" onClick={() => open("resource", r)}>
                  Edit resource
                </button>
              </div>
            ))
          )}
        </>
      )}
      {section === "contacts" && (
        <>
          <p>
            School, trusted grownups, doctors, and the numbers you both need.
            This is a shared address book.
          </p>
          <button onClick={() => open("contact")}>＋ Add contact</button>
          {!data.contacts.length ? (
            <Empty title="Keep important numbers close">
              Add your first contact and pin important numbers to the top.
            </Empty>
          ) : (
            <ContactCards
              items={data.contacts}
              edit={(c) => open("contact", c)}
            />
          )}
        </>
      )}
      {section === "consistency" && (
        <>
          <p>
            Two homes, a shared approach. Answer in your own words, compare
            perspectives, and agree on a practical plan. A plan becomes agreed
            when both parents approve it; changing it asks you both to agree
            again.
          </p>
          <button onClick={() => open("exercise")}>
            ＋ Start a conversation
          </button>
          {!data.exercises.length ? (
            <Empty title="Start with one small agreement">
              Try bedtime, screens, big feelings, or your own question. You
              don't have to agree on everything at once.
            </Empty>
          ) : (
            data.exercises.map((x) => (
              <article className="hub-card exercise" key={x.id}>
                <span className="hub-chip">
                  {data.members.length === 2 && x.approvals.length === 2
                    ? "✓ Agreed by both parents"
                    : "In conversation"}
                </span>
                <h2>{x.question}</h2>
                <div className="parent-answers">
                  {data.members.map((m) => (
                    <div key={m.id}>
                      <strong>{m.name}</strong>
                      <p className="preserve-lines">
                        {x.answers[m.id] || "Hasn't answered yet"}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="shared-plan">
                  <strong>Our shared approach</strong>
                  <p className="preserve-lines">
                    {x.plan ||
                      "Write a small, specific plan you can both follow."}
                  </p>
                </div>
                <p className="muted">
                  Agreed:{" "}
                  {x.approvals
                    .map((id) => data.members.find((m) => m.id === id)?.name)
                    .filter(Boolean)
                    .join(", ") || "Waiting for agreement"}
                </p>
                <div className="hub-actions">
                  <button
                    className="secondary"
                    onClick={() => open("exercise", x)}
                  >
                    My answer & shared plan
                  </button>
                  {x.plan && !x.approvals.includes(viewer) && (
                    <button
                      disabled={busy}
                      onClick={() => void action("approvePlan", x)}
                    >
                      I agree to this plan
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </>
      )}
      {section === "chat" && (
        <div className="parent-chat">
          <div className="chat-titlebar">
            <span aria-hidden="true">💬</span>
            <strong>Parent lounge</strong>
            <span>Private</span>
          </div>
          <p className="chat-status">
            Just the two of you · updates every 3 seconds
          </p>
          <div
            className="chat-messages"
            onScroll={(e) => {
              const el = e.currentTarget;
              followChat.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            }}
            role="log"
            aria-label="Parent conversation"
            aria-live="polite"
            aria-relevant="additions"
          >
            {data.hasOlderMessages && (
              <button
                className="secondary"
                onClick={() => {
                  followChat.current = false;
                  hub.loadHistory();
                }}
              >
                Load earlier messages
              </button>
            )}
            {!data.messages.length && (
              <Empty title="You've got a place to talk">
                Leave a handoff note, ask a question, or share a small win. Your
                child cannot access this conversation.
              </Empty>
            )}
            {data.messages.map((m) => (
              <article
                key={m.id}
                className={"chat-bubble " + (m.by === viewer ? "mine" : "")}
              >
                <div>
                  <strong>{m.actor}</strong>
                  <time dateTime={m.at}>{when(m.at)}</time>
                </div>
                <p className="preserve-lines">{m.text}</p>
              </article>
            ))}
            <div ref={chatEnd} />
          </div>
          <form
            className="chat-compose"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = e.currentTarget,
                fields = new FormData(form);
              setBusy(true);
              setActionError("");
              try {
                await hub.save({
                  op: "message",
                  text: fields.get("text"),
                  key: sendKey.current,
                });
                form.reset();
                sendKey.current = crypto.randomUUID();
              } catch (e) {
                setActionError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Message
              <textarea
                name="text"
                onChange={() => {
                  sendKey.current = crypto.randomUUID();
                }}
                maxLength={2000}
                rows={3}
                required
                placeholder="A note for the other parent…"
                disabled={busy}
              />
            </label>
            <button disabled={busy}>
              {busy ? "Sending…" : "Send message ↗"}
            </button>
          </form>
        </div>
      )}
      {section === "rewards" && (
        <>
          <div className="star-summary">
            <span aria-hidden="true">✦</span>
            <div>
              <strong>{Math.max(0, data.balance)} stars</strong>
              <p>
                One star for each checked-off chore, plus stars you award for a
                little extra effort.
              </p>
            </div>
          </div>
          <div className="hub-actions">
            <button onClick={() => open("goal")}>＋ Add reward</button>
            <button className="secondary" onClick={() => open("recognition")}>
              Celebrate a win
            </button>
            <button className="secondary" onClick={() => open("childAccount")}>
              {data.child ? "Manage child login" : "Set up child login"}
            </button>
          </div>
          {data.child && (
            <p className="muted">
              Child username: <strong>{data.child.username}</strong> ·{" "}
              {data.child.enabled ? "Enabled" : "Disabled"}
            </p>
          )}
          <h2>Reward requests</h2>
          {!data.redemptions.length && (
            <p className="muted">
              Your child can request an earned reward from their own login. A
              parent approves before stars are spent.
            </p>
          )}
          {[...data.redemptions].reverse().map((r) => (
            <article className="hub-card" key={r.id}>
              <h3>
                {r.title} · {r.cost} stars
              </h3>
              <p>
                {r.status === "requested"
                  ? "Waiting for a parent"
                  : `${r.status === "approved" ? "Approved" : "Declined"} by ${r.decidedBy}`}
              </p>
              {r.status === "requested" && (
                <div className="hub-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action("decideReward", r, { status: "approved" })
                    }
                  >
                    Approve reward
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action("decideReward", r, { status: "declined" })
                    }
                  >
                    Decline request
                  </button>
                </div>
              )}
            </article>
          ))}
          <h2>Rewards to work toward</h2>
          {!data.goals.length && (
            <Empty title="Choose something to look forward to">
              A family game night or picking the next story can be a reward. You
              choose the goal and star cost.
            </Empty>
          )}
          {data.goals.map((g) => (
            <article className="hub-card" key={g.id}>
              <h3>
                {g.title} <span className="hub-chip">{g.cost} ★</span>
              </h3>
              <p>{g.archived ? "Archived" : "Available"}</p>
              <button className="secondary" onClick={() => open("goal", g)}>
                Edit reward
              </button>
            </article>
          ))}
          <h2>Little wins</h2>
          <RecognitionList data={data} />
          <h2>Chore star history</h2>
          <p className="muted">
            A chore earns one star per calendar day in your household's routine
            time zone. Undoing its checkoff removes that star. Approved rewards
            stay approved; future stars cover any difference first.
          </p>
          <ul className="star-history">
            {data.awards.slice(0, 60).map((x) => (
              <li key={x.record + x.day}>
                <span>
                  {x.active ? "★" : "☆"} {x.title}
                </span>
                <small>
                  {x.day} · {x.active ? "+1 star" : "Checkoff undone"}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
      {section === "profile" && (
        <>
          <p>
            {section === "profile"
              ? "Make your place on the team feel like you."
              : "Your colors, type, and background travel with your account. The other parent's preferences stay their own."}
          </p>
          <article className="hub-card">
            <span className="profile-avatar" aria-hidden="true">
              {data.profile.avatar}
            </span>
            <h2>{data.profile.name}</h2>
            {data.profile.about && <p>{data.profile.about}</p>}
            <button onClick={() => open("profile")}>Edit my profile</button>
          </article>
        </>
      )}
    </section>
  );
}
function RecognitionList({ data }: { data: HubView }) {
  return (
    <div className="hub-stack">
      {!data.recognitions.length && (
        <p className="muted">
          Small efforts deserve to be noticed. Your grownups can leave a
          celebration here.
        </p>
      )}
      {[...data.recognitions].reverse().map((r) => (
        <article className="recognition" key={r.id}>
          <span aria-hidden="true">🌟</span>
          <div>
            <p>{r.text}</p>
            <small>
              {r.actor} · {when(r.at)}
              {r.stars > 0 ? ` · +${r.stars} stars` : ""}
            </small>
          </div>
        </article>
      ))}
    </div>
  );
}
export function ChildSpace({
  user,
  team,
  onSignedOut,
}: {
  user: { id: string; name: string };
  team: string;
  onSignedOut: () => Promise<void>;
}) {
  const hub = useHub(user.id),
    { data, error } = hub;
  const [tab, setTab] = useState("today"),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [editing, setEditing] = useState<"profile" | "settings" | null>(null);
  const rewardKeys = useRef<Record<string, string>>({});
  const initialTab = useRef(false);
  useEffect(() => {
    if (data) {
      applyAppearance(data.profile.appearance);
      if (!initialTab.current) {
        initialTab.current = true;
        setTab(data.profile.appearance.startPage ?? "today");
      }
    }
  }, [data]);
  useEffect(() => () => resetAppearance(), []);
  if (!data)
    return (
      <main>
        <SharingStatus />
        <p role={error ? "alert" : "status"}>
          {error || "Opening your space…"}
        </p>
        <button
          onClick={async () => {
            await fetch("/api/child/logout", { method: "POST" });
            await onSignedOut();
          }}
        >
          Sign out
        </button>
      </main>
    );
  if (editing)
    return (
      <main>
        <SharingStatus />
        {editing === "settings" ? (
          <>
            <button className="text back" onClick={() => setEditing(null)}>
              ← Back to my space
            </button>
            <AppSettings data={data} save={hub.save} />
          </>
        ) : (
          <>
            <HubEditor
              editing={{ kind: "profile" }}
              data={data}
              viewer={user.id}
              save={hub.save}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
              onLatest={() => {}}
            />
          </>
        )}
      </main>
    );
  return (
    <main className="child-space">
      <header>
        <Brand name={team} />
        <button
          className="text signout"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await fetch("/api/child/logout", { method: "POST" });
              if (!r.ok) throw Error("Could not sign out. Please retry.");
              await onSignedOut();
            } catch (e) {
              setActionError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out
        </button>
      </header>
      <SharingStatus />
      <div className="child-hero">
        <p className="section-kicker">Your team is cheering you on</p>
        <h1>
          Hey, {user.name}! <span aria-hidden="true">✧</span>
        </h1>
        <p className="child-balance">
          <span aria-hidden="true">★</span> {Math.max(0, data.balance)} stars
        </p>
        <p>Little things. Big growing.</p>
      </div>
      <nav className="child-nav" aria-label="My space">
        {[
          ["today", "My day"],
          ["rewards", "Rewards"],
          ["gallery", "Photos"],
          ["resources", "Discover"],
          ["contacts", "My contacts"],
          ["location", "My location"],
        ].map(([id, label]) => (
          <button
            className={tab === id ? "active" : "secondary"}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {(error || actionError) && (
        <p className="error" role="alert">
          {actionError || error}
        </p>
      )}
      {tab === "location" && <LocationPanel />}
      {tab === "today" && (
        <>
          <h2>My day</h2>
          <p>
            Your grownup checks off finished tasks. Each chore earns you a star!
          </p>
          {!data.chores.length && (
            <Empty title="Room for a new adventure">
              Your grownups can add routines and chores for you.
            </Empty>
          )}
          <ul className="child-checklist">
            {data.chores.map((c) => (
              <li key={c.id}>
                <span aria-hidden="true">{c.checked ? "✓" : "○"}</span>
                <span>{c.title}</span>
                {c.type === "chore" && (
                  <small>{c.checked ? "★ Earned" : "☆ 1 star"}</small>
                )}
              </li>
            ))}
          </ul>
          <h2>Look what you did!</h2>
          <RecognitionList data={data} />
          <button className="secondary" onClick={() => setEditing("settings")}>
            Make this space mine 🎨
          </button>
          <button className="text" onClick={() => setEditing("profile")}>
            My profile
          </button>
        </>
      )}
      {tab === "gallery" && (
        <>
          <h2>Our little moments</h2>
          {data.photos.length ? (
            <Gallery photos={data.photos} />
          ) : (
            <Empty title="Your photo album starts here">
              Photos your grownups share with you will appear here.
            </Empty>
          )}
        </>
      )}
      {tab === "resources" && (
        <>
          <h2>Something to discover</h2>
          {data.resources.length ? (
            <ResourceCards items={data.resources} />
          ) : (
            <Empty title="Your discovery shelf">
              Your grownups can save things to read, learn, and try here.
            </Empty>
          )}
        </>
      )}
      {tab === "contacts" && (
        <>
          <h2>People on my team</h2>
          {data.contacts.length ? (
            <ContactCards items={data.contacts} />
          ) : (
            <Empty title="Your trusted people">
              Your grownups can add contacts for you here.
            </Empty>
          )}
        </>
      )}
      {tab === "rewards" && (
        <>
          <h2>Something to look forward to</h2>
          {!data.goals.some((g) => !g.archived) && (
            <Empty title="Your next goal is on its way">
              Ask a grownup to add a reward you'd enjoy.
            </Empty>
          )}
          {data.goals
            .filter((g) => !g.archived)
            .map((g) => (
              <article className="hub-card child-goal" key={g.id}>
                <span aria-hidden="true">🎁</span>
                <h3>{g.title}</h3>
                <p>{g.cost} stars</p>
                <progress
                  aria-label={g.title + " progress"}
                  max={g.cost}
                  value={Math.min(g.cost, Math.max(0, data.balance))}
                />
                <button
                  disabled={
                    busy ||
                    data.balance < g.cost ||
                    data.redemptions.some(
                      (r) => r.goal === g.id && r.status === "requested",
                    )
                  }
                  onClick={async () => {
                    setBusy(true);
                    setActionError("");
                    try {
                      await hub.save({
                        op: "requestReward",
                        goal: g.id,
                        key: (rewardKeys.current[g.id] ??= crypto.randomUUID()),
                      });
                      delete rewardKeys.current[g.id];
                    } catch (e) {
                      setActionError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {data.redemptions.some(
                    (r) => r.goal === g.id && r.status === "requested",
                  )
                    ? "Waiting for a grownup"
                    : data.balance < g.cost
                      ? `${g.cost - Math.max(0, data.balance)} more stars to go`
                      : "Ask for this reward"}
                </button>
              </article>
            ))}
          <h2>My reward requests</h2>
          {[...data.redemptions].reverse().map((r) => (
            <article className="hub-card" key={r.id}>
              <h3>{r.title}</h3>
              <p>
                {r.status === "approved"
                  ? "🎉 Your grownup said yes!"
                  : r.status === "declined"
                    ? "Not this time. Talk with your grownup about it."
                    : "Your grownup will take a look."}
              </p>
            </article>
          ))}
        </>
      )}
    </main>
  );
}
function HubEditor({
  editing,
  data,
  viewer,
  save,
  onDone,
  onCancel,
  onLatest,
}: {
  editing: Editing;
  data: HubView;
  viewer: string;
  save: (b: Record<string, unknown>) => Promise<HubView>;
  onDone: () => void;
  onCancel: () => void;
  onLatest: () => void;
}) {
  const { kind, item } = editing;
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reset, setReset] = useState(0);
  const key = useRef(crypto.randomUUID()),
    uploadId = useRef<string | null>(null);
  const baseline = useRef({
    profile: data.profile.version,
    child: data.child?.version ?? "",
  });
  const label =
    kind === "childAccount"
      ? "Child login"
      : kind === "recognition"
        ? "Celebrate a win"
        : kind === "profile"
          ? "My profile"
          : kind === "exercise"
            ? "Parenting together"
            : `${item ? "Edit" : "Add"} ${kind === "goal" ? "reward" : kind}`;
  const field = (
    name: string,
    label: string,
    max: number,
    required = false,
    initial?: string,
    type = "text",
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        name={name}
        type={type}
        maxLength={max}
        defaultValue={initial ?? item?.[name] ?? ""}
        required={required}
      />
    </label>
  );
  const area = (name: string, label: string, max: number, initial?: string) => (
    <label>
      {label}
      <textarea
        aria-label={label}
        name={name}
        rows={4}
        maxLength={max}
        defaultValue={initial ?? item?.[name] ?? ""}
      />
    </label>
  );
  const check = (name: string, label: string, initial = false) => (
    <label className="check-label">
      <input
        type="checkbox"
        name={name}
        defaultChecked={item?.[name] ?? initial}
      />
      {label}
    </label>
  );
  return (
    <section className="hub-editor">
      <button className="text back" disabled={busy} onClick={onCancel}>
        ← Back
      </button>
      <h1>{label}</h1>
      <form
        key={(item?.id ?? kind) + ":" + reset}
        onChange={() => {
          key.current = crypto.randomUUID();
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const form = new FormData(e.currentTarget),
            b: Record<string, unknown> = {
              ...Object.fromEntries(form),
              op: kind,
              key: key.current,
            };
          setBusy(true);
          setError("");
          try {
            if (item) {
              b.id = item.id;
              b.version = item.version;
            }
            if (["photo", "contact"].includes(kind))
              b.childVisible = form.has("childVisible");
            if (kind === "contact") b.important = form.has("important");
            if (kind === "goal") {
              b.cost = Number(form.get("cost"));
              b.archived = form.has("archived");
            }
            if (kind === "recognition") b.stars = Number(form.get("stars"));
            if (kind === "exercise") {
              if (item) b.question = item.question;
              else if (String(b.customQuestion ?? "").trim())
                b.question = b.customQuestion;
              b.previousAnswer = item?.answers[viewer] ?? "";
            }
            if (kind === "childAccount") {
              b.enabled = form.has("enabled");
              b.version = baseline.current.child;
            }
            if (kind === "profile") {
              b.version = baseline.current.profile;
            }
            if (kind === "photo" && !item) {
              const file = form.get("file");
              if (!(file instanceof File) || !file.size)
                throw Error("Choose a photo first.");
              if (
                !["image/jpeg", "image/png"].includes(file.type) ||
                file.size > 10485760
              )
                throw Error(
                  "Choose a JPEG or PNG up to 10 MB. Export HEIC as JPEG.",
                );
              if (!uploadId.current) {
                const me = await fetch("/api/me").then((r) => r.json());
                let r: Response;
                if (me.uploads === "direct")
                  r = await fetch("/api/hub/uploads", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: file.name,
                      mime: file.type,
                      size: file.size,
                    }),
                  });
                else {
                  const f = new FormData();
                  f.set("file", file);
                  r = await fetch("/api/hub/uploads", {
                    method: "POST",
                    body: f,
                  });
                }
                const prepared = await r.json();
                if (!r.ok) throw Error(prepared.error);
                if (prepared.url) {
                  const sent = await fetch(prepared.url, {
                    method: "PUT",
                    headers: {
                      "Content-Type": file.type,
                      "x-upsert": "false",
                      apikey: prepared.publishableKey,
                    },
                    credentials: "omit",
                    body: file,
                  });
                  if (!sent.ok)
                    throw Error(
                      "The photo didn't finish uploading. Your caption is kept; try again.",
                    );
                }
                uploadId.current = prepared.id;
              }
              b.uploadId = uploadId.current;
              delete b.file;
            }
            await save(b);
            onDone();
          } catch (e) {
            setError((e as Error).message);
            if (
              kind === "photo" &&
              !item &&
              [400, 404, 413].includes(
                (e as Error & { status?: number }).status ?? 0,
              )
            )
              uploadId.current = null;
          } finally {
            setBusy(false);
          }
        }}
      >
        {kind === "photo" && (
          <>
            {!item && (
              <label>
                Photo
                <input
                  name="file"
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={busy}
                  required
                  onChange={() => {
                    uploadId.current = null;
                    key.current = crypto.randomUUID();
                  }}
                />
                <small>
                  JPEG or PNG, up to 10 MB. Tap the image picker to take or
                  choose a photo.
                </small>
              </label>
            )}
            {area("caption", "Caption", 300)}
            {check("childVisible", "Show in child view")}
          </>
        )}
        {kind === "resource" && (
          <>
            {field("title", "Title", 160, true)}
            {area("details", "Guidance or notes", 4000)}
            {field(
              "url",
              "HTTPS link (optional)",
              1000,
              false,
              undefined,
              "url",
            )}
            <label>
              Who is it for?
              <select
                name="audience"
                defaultValue={item?.audience ?? "parents"}
              >
                <option value="parents">Parents only</option>
                <option value="child">Parents and child</option>
              </select>
            </label>
          </>
        )}
        {kind === "contact" && (
          <>
            {field("name", "Contact name", 120, true)}
            {field("role", "Role or relationship", 120)}
            {field("phone", "Phone number", 60, false, undefined, "tel")}
            {field("email", "Email address", 254, false, undefined, "email")}
            {area("note", "Notes", 2000)}
            {check("important", "Pin as an important contact")}
            {check("childVisible", "Show in child view")}
          </>
        )}
        {kind === "exercise" && (
          <>
            {item ? (
              <h2>{item.question}</h2>
            ) : (
              <label>
                Choose a starting question
                <select name="question" defaultValue={consistencyQuestions[0]}>
                  {consistencyQuestions.map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              </label>
            )}
            {!item && (
              <p className="muted">
                You can also replace this question by choosing a custom prompt
                below.
              </p>
            )}
            {!item && field("customQuestion", "Or ask your own question", 300)}
            {area("answer", "My answer", 2000, item?.answers[viewer] ?? "")}
            {area("plan", "Our shared approach", 2000, item?.plan ?? "")}
            <p className="muted">
              Only your answer changes. The other parent's answer stays theirs.
              Editing an answer or shared plan clears earlier approvals.
            </p>
          </>
        )}
        {kind === "goal" && (
          <>
            {field("title", "Reward", 160, true)}
            <label>
              Star cost
              <input
                name="cost"
                type="number"
                min={1}
                max={10000}
                step={1}
                defaultValue={item?.cost ?? 5}
                required
              />
            </label>
            {check("archived", "Archive this reward")}
          </>
        )}
        {kind === "recognition" && (
          <>
            {area("text", "What are you celebrating?", 500)}
            <label>
              Extra stars (optional)
              <input
                name="stars"
                type="number"
                min={0}
                max={100}
                defaultValue={0}
                required
              />
            </label>
            <p className="muted">
              A warm word can be enough. Leave stars at zero for recognition
              without points.
            </p>
          </>
        )}
        {kind === "childAccount" && (
          <>
            <p>
              A separate login for your child. It can see routines, stars,
              rewards, and items you explicitly share. It cannot access parent
              chat, parenting exercises, health notes, or parent APIs.
            </p>
            {field(
              "username",
              "Child username",
              40,
              true,
              data.child?.username ?? "",
            )}
            {field("password", "New child password", 200, true, "", "password")}
            <p className="muted">
              Use 12–200 characters. A short phrase works well. Saving resets
              the password and signs out existing child sessions.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={data.child?.enabled ?? true}
              />
              Enable child login
            </label>
          </>
        )}
        {kind === "profile" && (
          <>
            {data.role === "parent" &&
              field("name", "Display name", 80, true, data.profile.name)}
            <label>
              Avatar
              <select
                aria-label="Avatar"
                name="avatar"
                defaultValue={data.profile.avatar}
              >
                {["🌟", "🙂", "👩‍🍳", "👨‍🍳", "🌻", "🐻", "🦊", "🚀", "🌈"].map(
                  (a) => (
                    <option key={a}>{a}</option>
                  ),
                )}
              </select>
            </label>
            {area("about", "A little about me", 300, data.profile.about)}
          </>
        )}
        {error && (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onLatest();
                baseline.current = {
                  profile: data.profile.version,
                  child: data.child?.version ?? "",
                };
                setReset((x) => x + 1);
                key.current = crypto.randomUUID();
                setError("");
              }}
            >
              Discard draft and load latest details
            </button>
          </>
        )}
        <div className="hub-actions">
          <button disabled={busy}>
            {busy
              ? "Saving…"
              : kind === "photo" && !item
                ? "Add photo"
                : kind === "recognition"
                  ? "Share recognition"
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
      {item && ["photo", "resource", "contact"].includes(kind) && (
        <button
          className="text danger"
          disabled={busy}
          onClick={async () => {
            if (!confirm("Remove this item from your shared space?")) return;
            setBusy(true);
            try {
              await save({
                op: "delete",
                id: item.id,
                version: item.version,
                collection:
                  kind === "photo"
                    ? "photos"
                    : kind === "resource"
                      ? "resources"
                      : "contacts",
                key: crypto.randomUUID(),
              });
              onDone();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove {kind === "photo" ? "from gallery" : kind}
        </button>
      )}
    </section>
  );
}
