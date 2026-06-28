"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentDraft, EnrichedPerson, MessageDraft, PersonCard, PersonMetrics, Synthesis } from "../../src/types";
import { InterestRadar } from "../../src/ui/radar";

// ---- design tokens (from the Cadence design) ----
const C = {
  bg: "#FAF9F6", panel: "#FFFFFF", border: "#ECEAE4", soft: "#F1EFE9",
  ink: "#1A1916", ink2: "#332F2A", ink3: "#56524B", ink4: "#6B6862",
  mut: "#8A857C", mut2: "#9A968D", mut3: "#B6B1A8", faint: "#C2BDB3",
  accent: "#F25C1F", accentDk: "#DB4F15", accentBg: "#FDF1EA", accentTxt: "#C24E12",
  green: "#1A7F5A", greenBg: "#E6F4EC",
  serif: "'Newsreader', Georgia, serif", sans: "'Hanken Grotesk', system-ui, sans-serif",
};

type Mode = "comment" | "message";
type Channel = "dm" | "email";
type Detail = { dossier: EnrichedPerson; synthesis: Synthesis | null; metrics: PersonMetrics | null; comment: CommentDraft | null; message: MessageDraft | null };
type StatusMap = Record<string, { comment: string; message: string }>;

const STATUS_META: Record<string, { label: string; dot: string; bg: string; fg: string }> = {
  draft: { label: "Draft", dot: "#C9C5BC", bg: "#F0EEE8", fg: "#8A857C" },
  copied: { label: "Copied", dot: C.accent, bg: C.accentBg, fg: C.accentTxt },
  posted: { label: "Posted", dot: C.green, bg: C.greenBg, fg: C.green },
  sent: { label: "Sent", dot: C.green, bg: C.greenBg, fg: C.green },
  replied: { label: "Replied", dot: "#5B53D6", bg: "#ECEBFB", fg: "#5B53D6" },
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const firstName = (name: string) => name.split(/\s+/)[0] || "there";
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const fmtTenure = (months: number) => (months < 12 ? `${months}mo` : `${Math.floor(months / 12)}y${months % 12 ? ` ${months % 12}mo` : ""}`);

export default function Workspace() {
  const [people, setPeople] = useState<PersonCard[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [mode, setMode] = useState<Mode>("comment");
  const [channel, setChannel] = useState<Channel>("dm");
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "you" | "targets">(null);
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [product, setProduct] = useState("");
  const [voice, setVoice] = useState("");

  // editable buffers
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [origBody, setOrigBody] = useState("");
  const [origSubject, setOrigSubject] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  // load persisted "you" + statuses
  useEffect(() => {
    setProduct(localStorage.getItem("ccg.product") ?? "");
    setVoice(localStorage.getItem("ccg.voice") ?? "");
    try { setStatuses(JSON.parse(localStorage.getItem("ccg.status") ?? "{}")); } catch { /* ignore */ }
  }, []);

  const saveStatuses = (next: StatusMap) => {
    setStatuses(next);
    localStorage.setItem("ccg.status", JSON.stringify(next));
  };

  async function loadPeople() {
    const res = await fetch("/api/people");
    const data = res.ok ? await res.json() : { people: [] };
    setPeople(data.people ?? []);
    if (!selectedId && data.people?.length) setSelectedId(data.people[0].id);
    return data.people as PersonCard[];
  }
  useEffect(() => { loadPeople(); /* eslint-disable-next-line */ }, []);

  // load detail when champion changes
  useEffect(() => {
    if (!selectedId) return;
    setDetail(null);
    (async () => {
      const res = await fetch(`/api/people/${selectedId}`);
      if (!res.ok) return;
      const d: Detail = await res.json();
      setDetail(d);
      setMode((d.dossier.posts?.length ?? 0) > 0 ? "comment" : "message");
    })();
  }, [selectedId]);

  // sync editable buffers to the active draft
  useEffect(() => {
    if (!detail) return;
    if (mode === "comment") {
      const t = detail.comment?.comment ?? "";
      setBody(t); setOrigBody(t);
    } else {
      const t = detail.message?.message ?? "";
      const s = detail.message?.subject ?? "";
      setBody(t); setOrigBody(t); setSubject(s); setOrigSubject(s);
    }
  }, [detail, mode]);

  const champ = detail?.dossier;
  const stOf = (id: string) => statuses[id] ?? { comment: "draft", message: "draft" };

  async function generate(force = false) {
    if (!selectedId || !detail) return;
    if (!force) {
      // only auto-generate when the active mode has no draft yet
      if (mode === "comment" && detail.comment?.comment) return;
      if (mode === "message" && detail.message?.message) return;
    }
    if (mode === "comment" && (champ?.posts.length ?? 0) === 0) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/people/${selectedId}/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceInput: voice, product }),
      });
      if (res.ok) {
        const data = await res.json();
        setDetail((d) => (d ? { ...d, [mode]: data[mode] } : d));
      }
    } finally {
      setGenerating(false);
    }
  }

  // auto-draft the active mode when missing
  useEffect(() => {
    if (!detail || generating) return;
    const missing = mode === "comment" ? !detail.comment?.comment : !detail.message?.message;
    const canComment = mode === "comment" ? (champ?.posts.length ?? 0) > 0 : true;
    if (missing && canComment) generate(false);
    // eslint-disable-next-line
  }, [detail, mode]);

  const advance = (next: string) => {
    if (!selectedId) return;
    const cur = stOf(selectedId);
    if (cur[mode] === "draft") saveStatuses({ ...statuses, [selectedId]: { ...cur, [mode]: "copied" } });
  };
  const mark = (val: string) => {
    if (!selectedId) return;
    const cur = stOf(selectedId);
    saveStatuses({ ...statuses, [selectedId]: { ...cur, [mode]: val } });
  };

  const copy = (withSubject = false) => {
    let text = body;
    if (withSubject && subject) text = `Subject: ${subject}\n\n${body}`;
    navigator.clipboard?.writeText(text).catch(() => {});
    advance("copied");
    showToast(
      mode === "comment"
        ? `Copied — paste it under ${firstName(champ?.name ?? "")}'s post`
        : channel === "email" ? "Copied — ready to send" : "Copied — paste into the DM",
    );
  };

  const saveYou = () => {
    localStorage.setItem("ccg.product", product);
    localStorage.setItem("ccg.voice", voice);
    setModal(null);
    showToast("Saved your product & voice");
  };

  // ---- render ----
  if (people && people.length === 0) {
    return <Shell onYou={() => setModal("you")} onTargets={() => setModal("targets")}>
      <EmptyState onYou={() => setModal("you")} onTargets={() => setModal("targets")} />
      {modal && <Modal kind={modal} onClose={() => setModal(null)} {...{ product, setProduct, voice, setVoice, saveYou }} reload={loadPeople} />}
    </Shell>;
  }

  const bodyEdited = mode === "comment" ? body !== origBody : body !== origBody || subject !== origSubject;
  const status = selectedId ? stOf(selectedId)[mode] : "draft";
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const posts = champ ? [...champ.posts].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "")) : [];
  const recent = posts[0] ?? null;
  const older = posts.slice(1, 3);
  const email = champ?.workEmail || champ?.personalEmail || "";
  const noEmail = channel === "email" && !email;
  const channelLink = channel === "email"
    ? (email ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : "#")
    : (champ?.linkedinUrl ?? "#");
  const channelLabel = channel === "email" ? (email ? "Open email ↗" : "No email ↗") : "Open LinkedIn messages ↗";

  return (
    <Shell onYou={() => setModal("you")} onTargets={() => setModal("targets")}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* RAIL */}
        <div className="ccg-scroll" style={{ width: 74, flex: "none", borderRight: `1px solid ${C.border}`, background: C.panel, display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0", gap: 4, overflowY: "auto" }}>
          <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".1em", color: C.faint, marginBottom: 6 }}>PIPE</div>
          {(people ?? []).map((p) => {
            const active = p.id === selectedId;
            const pm = p.skills ? (stOf(p.id)) : { comment: "draft", message: "draft" };
            const dot = STATUS_META[pm.comment !== "draft" ? pm.comment : pm.message]?.dot ?? STATUS_META.draft.dot;
            return (
              <button key={p.id} onClick={() => setSelectedId(p.id)} title={`${p.name} · ${p.title ?? ""}`}
                style={{ position: "relative", width: 44, height: 44, borderRadius: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600,
                  border: active ? `1.5px solid ${C.accent}` : "1px solid transparent",
                  background: active ? C.accentBg : "#F4F2EC", color: active ? C.accentTxt : C.ink3 }}>
                {initials(p.name)}
                <span style={{ position: "absolute", bottom: 5, right: 5, width: 9, height: 9, borderRadius: 999, border: "2px solid #fff", background: dot }} />
              </button>
            );
          })}
          <button onClick={() => setModal("targets")} title="Add champion"
            style={{ marginTop: 6, width: 44, height: 44, borderRadius: 12, border: `1px dashed #D8D2C6`, background: "none", color: C.mut3, fontSize: 20, lineHeight: 1, cursor: "pointer" }}>+</button>
        </div>

        {/* CONTEXT PANEL */}
        <div className="ccg-scroll" style={{ width: "42%", maxWidth: 560, flex: "none", borderRight: `1px solid ${C.border}`, overflowY: "auto", padding: "26px 30px 60px" }}>
          {!champ ? <SkeletonBlock /> : <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 13, marginBottom: 14 }}>
              <div style={{ width: 48, height: 48, flex: "none", borderRadius: 999, background: "linear-gradient(135deg,#ECE7DD,#D6CFC2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, color: "#5B574F", fontSize: 17 }}>{initials(champ.name)}</div>
              <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em" }}>{champ.name}</span>
                  {champ.isInfluencer && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".03em", color: "#A4630A", background: "#FBF0DC", border: "1px solid #F0DDB8", padding: "1px 7px", borderRadius: 5 }}>TOP VOICE</span>}
                </div>
                <div style={{ fontSize: 13.5, color: C.ink4, marginTop: 2 }}>{champ.title}{champ.companyDomain ? ` · ${champ.companyDomain}` : ""}</div>
                <a href={champ.linkedinUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 4, fontSize: 12.5, color: C.mut2, textDecoration: "none", marginTop: 5 }}>{champ.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")} ↗</a>
              </div>
            </div>

            {detail?.synthesis?.summary && (
              <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "#FFFDFB", border: "1px solid #F1E4D8", borderRadius: 11, padding: "12px 14px", marginBottom: 24 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#C7873F", flex: "none", marginTop: 2 }}>WHY THEM</span>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: C.ink3 }}>{detail.synthesis.summary}</p>
              </div>
            )}

            {(detail?.synthesis?.currentFocus || (detail?.metrics && (detail.metrics.tenureMonths != null || detail.metrics.recentlyActive || detail.metrics.lastPostAt))) && (
              <div style={{ background: "#FBFAF8", border: `1px solid ${C.soft}`, borderRadius: 11, padding: "12px 14px", marginBottom: 24 }}>
                {detail?.synthesis?.currentFocus && (
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: C.ink3 }}>
                    <span style={{ fontWeight: 600, color: C.accentTxt }}>✦ Current focus: </span>{detail.synthesis.currentFocus}
                  </p>
                )}
                {detail?.metrics && (detail.metrics.tenureMonths != null || detail.metrics.recentlyActive || detail.metrics.lastPostAt) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: detail?.synthesis?.currentFocus ? 9 : 0, fontSize: 12, color: C.mut }}>
                    {detail.metrics.tenureMonths != null && <span style={chip}>⏳ {fmtTenure(detail.metrics.tenureMonths)} at {champ?.companyDomain}</span>}
                    {detail.metrics.recentlyActive && <span style={chip}>🟢 Active recently</span>}
                    {!detail.metrics.recentlyActive && detail.metrics.lastPostAt && <span style={chip}>Last posted {detail.metrics.lastPostAt}</span>}
                  </div>
                )}
              </div>
            )}

            {recent ? <>
              <Label>Their most recent post</Label>
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: "18px 19px", boxShadow: "0 1px 2px rgba(0,0,0,.025)", marginTop: 10 }}>
                <p style={{ margin: "0 0 14px", fontSize: 15, lineHeight: 1.62, color: C.ink2, whiteSpace: "pre-wrap" }}>{recent.text}</p>
                <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: C.mut2, borderTop: `1px solid #F4F2EC`, paddingTop: 11 }}>
                  <span>{fmtDate(recent.postedAt)}</span>
                  {recent.likes != null && <span>♥ {recent.likes} likes</span>}
                  {recent.url && <a href={recent.url} target="_blank" rel="noreferrer" style={{ color: C.mut2, textDecoration: "none", marginLeft: "auto" }}>Open ↗</a>}
                </div>
              </div>
              {older.length > 0 && <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                {older.map((po, i) => (
                  <a key={i} href={po.url ?? "#"} target="_blank" rel="noreferrer" style={{ display: "block", textDecoration: "none", border: `1px solid ${C.soft}`, borderRadius: 10, padding: "11px 13px" }}>
                    <p style={{ margin: "0 0 7px", fontSize: 13, lineHeight: 1.5, color: C.ink4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{po.text}</p>
                    <div style={{ display: "flex", gap: 13, fontSize: 11.5, color: C.mut3 }}><span>{fmtDate(po.postedAt)}</span>{po.likes != null && <span>♥ {po.likes}</span>}</div>
                  </a>
                ))}
              </div>}
            </> : (
              <div style={{ background: "#FBFAF8", border: "1px dashed #DCD6CC", borderRadius: 13, padding: "18px 19px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink3, marginBottom: 5 }}>No recent posts</div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: C.mut }}>{firstName(champ.name)} hasn't posted recently, so there's nothing to comment on. The Message mode still works from the rest of the dossier.</p>
              </div>
            )}

            {(detail?.synthesis?.interestProfile?.length ?? 0) > 0 && <div style={{ marginTop: 24 }}>
              <Label>Interest profile</Label>
              <div style={{ marginTop: 4, marginLeft: -6 }}>
                <InterestRadar data={detail!.synthesis!.interestProfile} stroke={C.accent} fill="#F9A06B" height={260} tickFill="#6B6862" />
              </div>
            </div>}

            {champ.webMentions?.length > 0 && <div style={{ marginTop: 22 }}>
              <Label>Web footprint</Label>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {champ.webMentions.slice(0, 5).map((f, i) => (
                  <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", border: `1px solid ${C.soft}`, borderRadius: 10, padding: "10px 12px" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".04em", color: C.mut, background: "#F4F2EC", padding: "3px 7px", borderRadius: 5, flex: "none", textTransform: "uppercase" }}>{f.category}</span>
                    <span style={{ fontSize: 13, color: C.ink3, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.title || f.url}</span>
                    <span style={{ fontSize: 11.5, color: C.mut3 }}>{hostOf(f.url)}</span>
                  </a>
                ))}
              </div>
            </div>}

            {(detail?.comment?.painPoints?.length ?? 0) > 0 && <div style={{ marginTop: 24 }}>
              <Label>What they care about</Label>
              <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 11 }}>
                {detail!.comment!.painPoints.map((pn, i) => (
                  <div key={i} style={{ display: "flex", gap: 11 }}>
                    <div style={{ width: 6, flex: "none", borderRadius: 3, background: "#F2C9AE", margin: "3px 0" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink2, marginBottom: 3 }}>{pn.label}</div>
                      <p style={{ margin: 0, fontFamily: C.serif, fontSize: 13.5, fontStyle: "italic", lineHeight: 1.5, color: C.mut }}>&ldquo;{pn.evidence}&rdquo;</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>}
          </>}
        </div>

        {/* OUTPUT PANEL */}
        <div className="ccg-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "26px 32px 60px", background: C.bg }}>
          <div style={{ maxWidth: 620 }}>
            {/* segmented + status */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <div style={{ display: "flex", padding: 3, background: "#F0EEE8", borderRadius: 11, gap: 2, width: 280 }}>
                {(["comment", "message"] as Mode[]).map((m) => (
                  <button key={m} onClick={() => setMode(m)} style={tabStyle(mode === m)}>{m === "comment" ? "Comment" : "Message"}</button>
                ))}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: meta.fg, background: meta.bg, padding: "4px 11px", borderRadius: 999 }}>{meta.label}</div>
            </div>

            {/* COMMENT MODE */}
            {mode === "comment" && (
              (champ && champ.posts.length === 0) ? (
                <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 30, textAlign: "center" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.ink2, marginBottom: 6 }}>No post to reply to</div>
                  <p style={{ margin: "0 auto 18px", maxWidth: 340, fontSize: 13.5, lineHeight: 1.55, color: C.mut }}>A comment needs one of their posts. {firstName(champ.name)} hasn't posted recently — but the dossier still supports a personalized message.</p>
                  <button onClick={() => setMode("message")} style={primaryBtn}>Switch to Message →</button>
                </div>
              ) : generating && !detail?.comment ? <Generating /> : detail?.comment ? <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Label inline>Your comment</Label>
                  <span style={{ fontSize: 12, color: C.mut3 }}>· replying to {firstName(champ?.name ?? "")}&apos;s post</span>
                  {bodyEdited && <EditedBadge />}
                </div>
                <DraftBox value={body} onChange={setBody} serif />
                <Actions>
                  <button onClick={() => copy(false)} style={darkBtn}>Copy comment</button>
                  <button onClick={() => generate(true)} style={ghostBtn} disabled={generating}>↻ Regenerate</button>
                  {recent?.url && <a href={recent.url} target="_blank" rel="noreferrer" style={ghostLink}>Open post ↗</a>}
                  {status !== "posted" && status !== "replied" && <button onClick={() => mark("posted")} style={greenBtn}>Mark as posted ✓</button>}
                </Actions>
                {(detail.comment.postAngles?.length ?? 0) > 0 && <div style={{ marginTop: 30, borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: C.mut3, marginBottom: 11 }}>Or post about it — angles</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {detail.comment.postAngles.map((a, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, border: `1px solid ${C.soft}`, borderRadius: 10, padding: "11px 13px", background: "#FBFAF8" }}>
                        <span style={{ fontSize: 11, color: C.faint, flex: "none", marginTop: 1 }}>{i + 1}</span>
                        <span style={{ fontSize: 13.5, lineHeight: 1.5, color: C.ink4 }}>{a}</span>
                      </div>
                    ))}
                  </div>
                </div>}
              </> : <Generating />
            )}

            {/* MESSAGE MODE */}
            {mode === "message" && <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ display: "flex", padding: 2, background: "#F0EEE8", borderRadius: 9, gap: 2 }}>
                  {(["dm", "email"] as Channel[]).map((ch) => (
                    <button key={ch} onClick={() => setChannel(ch)} style={tabStyle(channel === ch, true)}>{ch === "dm" ? "DM" : "Email"}</button>
                  ))}
                </div>
                <span style={{ fontSize: 12.5, color: C.mut2 }}>{channel === "email" ? "Personalized email — copy or open in your mail client" : "1:1 LinkedIn DM — copy and paste"}</span>
              </div>

              {channel === "email" && <div style={{ marginBottom: 12 }}>
                <Label>Subject</Label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: "100%", marginTop: 6, fontFamily: C.sans, fontSize: 14.5, fontWeight: 500, color: C.ink2, background: "#fff", border: `1px solid #E4E1D9`, borderRadius: 10, padding: "11px 14px", outline: "none" }} />
              </div>}

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Label inline>{channel === "email" ? "Email body" : "Your message"}</Label>
                {bodyEdited && <EditedBadge />}
              </div>

              {generating && !detail?.message ? <Generating /> : detail?.message ? <>
                <DraftBox value={body} onChange={setBody} serif minHeight={150} />
                <Actions>
                  <button onClick={() => copy(false)} style={darkBtn}>{channel === "email" ? "Copy body" : "Copy message"}</button>
                  {channel === "email" && <button onClick={() => copy(true)} style={ghostBtn}>Copy with subject</button>}
                  <button onClick={() => generate(true)} style={ghostBtn} disabled={generating}>↻ Regenerate</button>
                  <a href={channelLink} target="_blank" rel="noreferrer" style={{ ...ghostLink, color: noEmail ? C.faint : C.ink3, pointerEvents: noEmail ? "none" : "auto" }}>{channelLabel}</a>
                  {status !== "sent" && status !== "replied" && <button onClick={() => mark("sent")} style={greenBtn}>Mark as sent ✓</button>}
                </Actions>
                {noEmail && <p style={{ margin: "12px 0 0", fontSize: 12.5, color: C.mut3 }}>No email on file for {firstName(champ?.name ?? "")} — the DM channel still works.</p>}
              </> : <Generating />}
            </>}
          </div>
        </div>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: C.ink, color: "#fff", fontSize: 13.5, fontWeight: 500, padding: "11px 18px", borderRadius: 11, boxShadow: "0 8px 24px rgba(0,0,0,.18)", display: "flex", alignItems: "center", gap: 9, zIndex: 60 }}><span style={{ color: "#FF8A4D" }}>✓</span>{toast}</div>}

      {modal && <Modal kind={modal} onClose={() => setModal(null)} {...{ product, setProduct, voice, setVoice, saveYou }} reload={loadPeople} />}
    </Shell>
  );
}

// ---- small components ----
function Shell({ children, onYou, onTargets }: { children: React.ReactNode; onYou: () => void; onTargets: () => void }) {
  return (
    <div style={{ fontFamily: C.sans, height: "100vh", background: C.bg, color: C.ink, display: "flex", flexDirection: "column", overflow: "hidden", WebkitFontSmoothing: "antialiased" } as React.CSSProperties}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px", height: 54, flex: "none", borderBottom: `1px solid ${C.border}`, background: C.panel, zIndex: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, background: C.accent }} />
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}>Cadence</span>
          <span style={{ fontSize: 12, color: C.mut3, marginLeft: 4 }}>Champion Workspace</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={onYou} style={navBtn}>You</button>
          <button onClick={onTargets} style={navBtn}>Targets</button>
          <div style={{ width: 30, height: 30, borderRadius: 999, background: "linear-gradient(135deg,#2A2824,#56524B)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, marginLeft: 6 }}>You</div>
        </div>
      </div>
      {children}
      <style>{`
        .ccg-scroll{ scrollbar-width: thin; scrollbar-color: #DDD7CB transparent; }
        .ccg-scroll::-webkit-scrollbar{ width: 11px; height: 11px; }
        .ccg-scroll::-webkit-scrollbar-track{ background: transparent; }
        .ccg-scroll::-webkit-scrollbar-thumb{ background: #E2DCD0; border-radius: 8px; border: 3px solid transparent; background-clip: content-box; }
        .ccg-scroll::-webkit-scrollbar-thumb:hover{ background: #CFC8B9; background-clip: content-box; }
        .ccg-scroll::-webkit-scrollbar-corner{ background: transparent; }
      `}</style>
    </div>
  );
}

function Label({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: inline ? C.mut2 : C.mut2, display: inline ? "inline" : "block" }}>{children}</span>;
}
function EditedBadge() { return <span style={{ fontSize: 10.5, fontWeight: 600, color: C.accentTxt, background: "#FDF1EA", padding: "2px 8px", borderRadius: 5 }}>Edited by you</span>; }
function Actions({ children }: { children: React.ReactNode }) { return <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14, flexWrap: "wrap" }}>{children}</div>; }
function DraftBox({ value, onChange, serif, minHeight = 120 }: { value: string; onChange: (v: string) => void; serif?: boolean; minHeight?: number }) {
  return (
    <div style={{ position: "relative", background: "#fff", border: "1px solid #F1DFD1", borderRadius: 14, boxShadow: "0 2px 10px rgba(242,92,31,.06)", overflow: "hidden" }}>
      <div style={{ height: 3, background: "linear-gradient(90deg,#F25C1F,#F9A06B)" }} />
      <textarea value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
        style={{ display: "block", width: "100%", border: "none", resize: "vertical", fontFamily: serif ? C.serif : C.sans, fontSize: 18, lineHeight: 1.65, color: C.ink2, padding: "20px 22px", minHeight, outline: "none", background: "transparent" }} />
    </div>
  );
}
function Generating() {
  return (
    <div style={{ background: "#FFFDFB", border: "1px solid #F4D9C7", borderRadius: 14, padding: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
        <span style={{ width: 13, height: 13, borderRadius: 999, border: "2px solid #F2C9AE", borderTopColor: C.accent, display: "inline-block", animation: "ccgspin .9s linear infinite" }} />
        <span style={{ fontSize: 13, color: C.accentTxt, fontWeight: 500 }}>Writing in your voice…</span>
      </div>
      {[96, 100, 88, 64].map((w, i) => <div key={i} className="ccg-shim" style={{ height: 13, width: `${w}%`, marginBottom: 9, borderRadius: 6 }} />)}
      <style>{`@keyframes ccgspin{to{transform:rotate(360deg)}} @keyframes ccgshim{0%{background-position:-360px 0}100%{background-position:360px 0}} .ccg-shim{background:linear-gradient(90deg,#F0EEE8 25%,#F7F5F0 50%,#F0EEE8 75%);background-size:720px 100%;animation:ccgshim 1.3s infinite linear}`}</style>
    </div>
  );
}
function SkeletonBlock() { return <div className="ccg-shim" style={{ height: 160, borderRadius: 12 }}><style>{`@keyframes ccgshim{0%{background-position:-360px 0}100%{background-position:360px 0}} .ccg-shim{background:linear-gradient(90deg,#F0EEE8 25%,#F7F5F0 50%,#F0EEE8 75%);background-size:720px 100%;animation:ccgshim 1.3s infinite linear}`}</style></div>; }

function EmptyState({ onYou, onTargets }: { onYou: () => void; onTargets: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: C.accent, margin: "0 auto 22px" }} />
        <h1 style={{ margin: "0 0 10px", fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>Win your next 5 customers, one champion at a time</h1>
        <p style={{ margin: "0 auto 30px", maxWidth: 400, fontSize: 15, lineHeight: 1.55, color: C.mut }}>Cadence finds the champion at each target company, reads what they post, and drafts outreach in your voice. Two quick steps to start.</p>
        <div style={{ display: "flex", gap: 14, textAlign: "left", marginBottom: 26 }}>
          {[["STEP 1", "Add your voice", "Your product one-liner + a few of your posts, so every draft sounds like you.", "Set up “You”", onYou, darkBtn] as const,
            ["STEP 2", "Build a target list", "Describe an ICP or paste 2–5 companies. We find the champion at each.", "Build list →", onTargets, primaryBtn] as const].map(([s, t, d, b, fn, st], i) => (
            <div key={i} style={{ flex: 1, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, marginBottom: 8 }}>{s}</div>
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 5 }}>{t}</div>
              <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.5, color: C.mut }}>{d}</p>
              <button onClick={fn} style={st}>{b}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Modal({ kind, onClose, product, setProduct, voice, setVoice, saveYou, reload }: {
  kind: "you" | "targets"; onClose: () => void; product: string; setProduct: (v: string) => void;
  voice: string; setVoice: (v: string) => void; saveYou: () => void; reload: () => Promise<unknown>;
}) {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  async function findChampions() {
    if (!prompt.trim() || running) return;
    setRunning(true); setStatusText("starting…");
    const res = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, posts: true }) });
    if (!res.ok) { setStatusText("Error starting run"); setRunning(false); return; }
    const { jobId } = await res.json();
    const poll = setInterval(async () => {
      try {
        const j = await (await fetch(`/api/runs/${jobId}`)).json();
        setStatusText(`${j.status} — ${j.progress?.stage ?? ""} (${j.progress?.people ?? 0} people)`);
        if (j.status === "completed" || j.status === "failed") { clearInterval(poll); setRunning(false); await reload(); if (j.status === "completed") onClose(); }
      } catch { clearInterval(poll); setRunning(false); setStatusText("polling error"); }
    }, 2000);
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,25,22,.34)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "92vw", maxHeight: "84vh", overflowY: "auto", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 18, boxShadow: "0 24px 60px rgba(0,0,0,.22)", padding: "26px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-.01em" }}>{kind === "you" ? "You" : "Build a target list"}</h2>
          <button onClick={onClose} style={{ fontSize: 18, lineHeight: 1, color: C.mut3, background: "none", border: "none", cursor: "pointer", padding: 4 }}>×</button>
        </div>
        <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.5, color: C.mut }}>{kind === "you" ? "Your product + voice. Every draft is written from this." : "Describe an ICP or paste companies — we find the champion at each and scrape their posts."}</p>

        {kind === "you" ? <>
          <Label>Product one-liner</Label>
          <textarea value={product} onChange={(e) => setProduct(e.target.value)} placeholder="What you sell, in one line" style={modalInput(64)} />
          <div style={{ height: 16 }} />
          <Label>Your voice — paste a few of your own posts</Label>
          <textarea value={voice} onChange={(e) => setVoice(e.target.value)} placeholder={"Post 1...\n\nPost 2..."} style={modalInput(120)} />
          <button onClick={saveYou} style={{ ...primaryBtn, width: "100%", marginTop: 18, padding: 11 }}>Save</button>
        </> : <>
          <Label>Describe an ICP or paste companies</Label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder='e.g. Series A dev tool companies' style={modalInput(88)} />
          {statusText && <p style={{ fontSize: 12.5, color: C.mut, margin: "10px 0 0" }}>{statusText}</p>}
          <button onClick={findChampions} disabled={running} style={{ ...primaryBtn, width: "100%", marginTop: 16, padding: 11, opacity: running ? 0.6 : 1 }}>{running ? "Finding…" : "Find champions →"}</button>
        </>}
      </div>
    </div>
  );
}

// ---- style helpers ----
const navBtn: React.CSSProperties = { fontFamily: "inherit", fontSize: 13, fontWeight: 500, color: C.ink3, background: "none", border: "1px solid transparent", padding: "6px 11px", borderRadius: 8, cursor: "pointer" };
const chip: React.CSSProperties = { background: "#F4F2EC", borderRadius: 7, padding: "3px 9px" };
const tabStyle = (active: boolean, small = false): React.CSSProperties => ({ flex: small ? undefined : 1, padding: small ? "5px 14px" : "7px 0", textAlign: "center", fontFamily: "inherit", fontSize: 13, fontWeight: 600, borderRadius: small ? 7 : 9, border: "none", cursor: "pointer", color: active ? C.ink : C.mut, background: active ? "#fff" : "transparent", boxShadow: active ? "0 1px 2px rgba(0,0,0,.06)" : "none" });
const darkBtn: React.CSSProperties = { fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "#fff", background: C.ink, border: "none", padding: "9px 16px", borderRadius: 9, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { fontFamily: "inherit", fontSize: 13, fontWeight: 500, color: C.ink3, background: "#fff", border: `1px solid #E4E1D9`, padding: "9px 14px", borderRadius: 9, cursor: "pointer" };
const ghostLink: React.CSSProperties = { ...ghostBtn, textDecoration: "none", display: "inline-block" };
const greenBtn: React.CSSProperties = { fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: C.green, background: C.greenBg, border: `1px solid #BFE3CD`, padding: "9px 14px", borderRadius: 9, cursor: "pointer" };
const primaryBtn: React.CSSProperties = { fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, color: "#fff", background: C.accent, border: "none", padding: "10px 18px", borderRadius: 10, cursor: "pointer" };
const modalInput = (h: number): React.CSSProperties => ({ width: "100%", marginTop: 7, fontFamily: C.sans, fontSize: 14, lineHeight: 1.5, color: C.ink2, background: "#FBFAF8", border: `1px solid ${C.border}`, borderRadius: 11, padding: "12px 14px", minHeight: h, outline: "none", resize: "vertical" });
