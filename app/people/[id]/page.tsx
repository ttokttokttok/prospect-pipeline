"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { CommentDraft, EnrichedPerson, Synthesis, PersonMetrics, EmailDraft } from "../../../src/types";
import { Card, Badge, Button, Skeleton } from "../../../src/ui/primitives";
import { InterestRadar } from "../../../src/ui/radar";

export default function DossierPage() {
  const { id } = useParams<{ id: string }>();
  const [dossier, setDossier] = useState<EnrichedPerson | null>(null);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [metrics, setMetrics] = useState<PersonMetrics | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [comment, setComment] = useState<CommentDraft | null>(null);
  const [commentLoading, setCommentLoading] = useState(false);
  const [voice, setVoice] = useState("");
  const [product, setProduct] = useState("");
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);

  async function generate(force = false) {
    setSynthLoading(true);
    try {
      const res = await fetch(`/api/people/${id}/synthesize${force ? "?force=1" : ""}`, { method: "POST" });
      if (res.ok) setSynthesis((await res.json()).synthesis);
    } finally {
      setSynthLoading(false);
    }
  }

  // Founder voice + product persist across people (it's the same founder).
  async function draftComment() {
    setCommentLoading(true);
    try {
      localStorage.setItem("ccg.voice", voice);
      localStorage.setItem("ccg.product", product);
      const res = await fetch(`/api/people/${id}/comment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceInput: voice, product }),
      });
      if (res.ok) setComment((await res.json()).comment);
    } finally {
      setCommentLoading(false);
    }
  }

  useEffect(() => {
    setVoice(localStorage.getItem("ccg.voice") ?? "");
    setProduct(localStorage.getItem("ccg.product") ?? "");
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/people/${id}`);
      if (!res.ok) { setNotFound(true); return; }
      const data = await res.json();
      setDossier(data.dossier);
      setSynthesis(data.synthesis);
      setMetrics(data.metrics);
      setComment(data.comment ?? null);
      setDraft(data.draft ?? null);
      if (!data.synthesis) generate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function generateDraft(force = false) {
    setDraftLoading(true);
    setNeedsProfile(false);
    try {
      const res = await fetch(`/api/people/${id}/draft${force ? "?force=1" : ""}`, { method: "POST" });
      if (res.status === 409) { setNeedsProfile(true); return; }
      if (res.ok) setDraft((await res.json()).draft);
    } finally {
      setDraftLoading(false);
    }
  }

  function copyHooks() {
    if (!synthesis) return;
    const text = synthesis.hooks.map((h) => `• ${h.angle} (${h.why})`).join("\n");
    navigator.clipboard.writeText(text);
  }

  if (notFound) return <main className="mx-auto max-w-3xl p-6"><Link href="/" className="text-sm text-neutral-500">← Back</Link><p className="mt-4">Person not found.</p></main>;
  if (!dossier) return <main className="mx-auto max-w-3xl p-6"><Skeleton className="h-40" /></main>;

  const p = dossier;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/" className="text-sm text-neutral-500">← Back</Link>

      <header className="mt-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{p.name}</h1>
          {p.isInfluencer && <Badge className="bg-amber-100 text-amber-800">Top Voice</Badge>}
        </div>
        <div className="text-neutral-600">{p.title} · @{p.companyDomain}</div>
        {p.headline && <div className="mt-1 text-sm text-neutral-500">{p.headline}</div>}
        <div className="mt-2 flex gap-3 text-sm">
          <a className="text-blue-600 hover:underline" href={p.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>
          {p.twitter && <a className="text-blue-600 hover:underline" href={`https://x.com/${p.twitter}`} target="_blank" rel="noreferrer">X</a>}
          {p.workEmail && <a className="text-blue-600 hover:underline" href={`mailto:${p.workEmail}`}>{p.workEmail}</a>}
        </div>
      </header>

      {(() => {
        const hasChips = !!metrics && (metrics.tenureMonths != null || metrics.recentlyActive || metrics.lastPostAt != null);
        if (!synthesis?.currentFocus && !hasChips) return null; // don't render an empty panel
        return (
          <div className="mt-3 rounded-lg bg-blue-50 p-3">
            {synthesis?.currentFocus && (
              <p className="text-sm"><span className="font-semibold text-blue-900">✦ Current focus: </span><span className="text-blue-900">{synthesis.currentFocus}</span></p>
            )}
            {hasChips && (
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-600">
                {metrics!.tenureMonths != null && <span>⏳ {fmtTenure(metrics!.tenureMonths)} at {p.companyDomain}</span>}
                {metrics!.recentlyActive && <span>🟢 Active recently</span>}
                {!metrics!.recentlyActive && metrics!.lastPostAt && <span>Last posted {metrics!.lastPostAt}</span>}
              </div>
            )}
          </div>
        );
      })()}

      {/* AI synthesis — the centerpiece */}
      <Card className="mt-5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">✦ AI summary</h2>
          <div className="flex gap-2">
            <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={copyHooks}>Copy hooks</Button>
            <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={() => generate(true)} disabled={synthLoading}>Regenerate</Button>
          </div>
        </div>
        {synthLoading && !synthesis ? (
          <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /></div>
        ) : synthesis && (synthesis.summary || synthesis.hooks.length) ? (
          <>
            <p className="text-sm text-neutral-800">{synthesis.summary}</p>
            {synthesis.interestProfile && synthesis.interestProfile.length > 0 ? (
              <div className="mt-3"><InterestRadar data={synthesis.interestProfile} /></div>
            ) : synthesis.interests.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {synthesis.interests.map((t) => <Badge key={t} className="bg-blue-50 text-blue-700">{t}</Badge>)}
              </div>
            ) : null}
            {synthesis.hooks.length > 0 && (
              <ul className="mt-3 space-y-2">
                {synthesis.hooks.map((h, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-neutral-900">{h.angle}</span>
                    <span className="text-neutral-500"> — {h.why}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="text-sm text-neutral-500">Couldn&apos;t generate hooks. <button className="underline" onClick={() => generate(true)}>Retry</button></div>
        )}
      </Card>

      {/* Champion comment — targeted organic outreach in the founder's voice */}
      <Card className="mt-5 border-emerald-200 bg-emerald-50/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">✎ Draft comment (your voice)</h2>
          <div className="flex gap-2">
            {comment?.comment && (
              <Button
                className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                onClick={() => navigator.clipboard.writeText(comment.comment)}
              >
                Copy
              </Button>
            )}
            <Button onClick={draftComment} disabled={commentLoading || p.posts.length === 0}>
              {commentLoading ? "Drafting…" : comment ? "Regenerate" : "Draft comment"}
            </Button>
          </div>
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="Your product (one-liner)"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <textarea
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            placeholder="Your voice — paste a few of your own posts"
            rows={2}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm sm:row-span-2"
          />
        </div>

        {p.posts.length === 0 ? (
          <div className="text-sm text-neutral-500">No scraped posts for this person — re-run with posts enabled to draft a comment.</div>
        ) : commentLoading && !comment ? (
          <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /></div>
        ) : comment ? (
          <>
            {comment.postText && (
              <div className="mb-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-600">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Replying to their post</div>
                {comment.postText.slice(0, 280)}{comment.postText.length > 280 ? "…" : ""}
              </div>
            )}
            <div className="rounded-lg border border-emerald-300 bg-white p-3 text-sm text-neutral-900">{comment.comment}</div>
            {comment.painPoints.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {comment.painPoints.map((pp, i) => (
                  <li key={i}><span className="font-medium">{pp.label}</span> <span className="text-neutral-500">— {pp.evidence}</span></li>
                ))}
              </ul>
            )}
            {comment.postAngles.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Post angles</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-700">
                  {comment.postAngles.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-neutral-500">Add your product + voice, then draft a comment grounded in their recent posts.</div>
        )}
      </Card>

      <Card className="mt-5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">✉ Cold-email draft</h2>
          <div className="flex gap-2">
            {draft && <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={() => navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`).catch(() => {})}>Copy</Button>}
            <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={() => generateDraft(!!draft)} disabled={draftLoading}>
              {draftLoading ? "Drafting…" : draft ? "Regenerate" : "Draft email"}
            </Button>
          </div>
        </div>
        {needsProfile ? (
          <p className="text-sm text-neutral-600">Set up your <Link href="/settings" className="text-blue-600 underline">sender profile</Link> first to draft emails.</p>
        ) : draftLoading && !draft ? (
          <div className="space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-20 w-full" /></div>
        ) : draft && (draft.subject || draft.body) ? (
          <div className="space-y-2">
            <input
              aria-label="Email subject"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium"
            />
            <textarea
              aria-label="Email body"
              value={draft.body} rows={8}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        ) : draft ? (
          <div className="text-sm text-neutral-500">Couldn&apos;t draft an email. <button className="underline" onClick={() => generateDraft(true)}>Retry</button></div>
        ) : (
          <p className="text-sm text-neutral-500">No draft yet — click &quot;Draft email&quot;.</p>
        )}
      </Card>

      {p.skills.length > 0 && (
        <Section title="Skills">
          <div className="flex flex-wrap gap-1">{p.skills.map((s) => <Badge key={s}>{s}</Badge>)}</div>
        </Section>
      )}

      {p.experience.length > 0 && (
        <Section title="Experience">
          <ol className="space-y-3 border-l border-neutral-200 pl-4">
            {p.experience.map((e, i) => (
              <li key={i}>
                <div className="text-sm font-medium">{e.title} · {e.company}</div>
                <div className="text-xs text-neutral-500">{e.startDate ?? ""}{e.endDate ? ` – ${e.endDate}` : e.isCurrent ? " – present" : ""}</div>
                {e.summary && <div className="text-sm text-neutral-600">{e.summary}</div>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {p.education.length > 0 && (
        <Section title="Education">
          <ul className="space-y-1 text-sm text-neutral-700">
            {p.education.map((ed, i) => <li key={i}>{ed.school}{ed.degree ? ` — ${ed.degree}` : ""}{ed.field ? `, ${ed.field}` : ""}{ed.endYear ? ` (${ed.endYear})` : ""}</li>)}
          </ul>
        </Section>
      )}

      {p.posts.length > 0 && (
        <Section title="Recent posts">
          <div className="space-y-2">
            {[...p.posts]
              .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
              .slice(0, 3)
              .map((post, i) => (
              <Card key={i} className="p-3">
                <p className="text-sm text-neutral-800">{post.text}</p>
                <div className="mt-1 text-xs text-neutral-400">
                  {post.postedAt ?? ""}{post.likes != null ? ` · ${post.likes} likes` : ""}
                  {post.url && <> · <a className="text-blue-600 hover:underline" href={post.url} target="_blank" rel="noreferrer">view</a></>}
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {p.webMentions.length > 0 && (
        <Section title="Web footprint">
          <ul className="space-y-1 text-sm">
            {p.webMentions.map((m, i) => (
              <li key={i}>
                <Badge className="mr-2">{m.category}</Badge>
                <a className="text-blue-600 hover:underline" href={m.url} target="_blank" rel="noreferrer">{m.title || m.url}</a>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </main>
  );
}

function fmtTenure(months: number): string {
  if (months < 12) return `${months} mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y}y ${m}mo` : `${y} yr${y > 1 ? "s" : ""}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}
