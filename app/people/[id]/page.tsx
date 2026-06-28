"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { EnrichedPerson, Synthesis } from "../../../src/types";
import { Card, Badge, Button, Skeleton } from "../../../src/ui/primitives";

export default function DossierPage() {
  const { id } = useParams<{ id: string }>();
  const [dossier, setDossier] = useState<EnrichedPerson | null>(null);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  async function generate() {
    setSynthLoading(true);
    try {
      const res = await fetch(`/api/people/${id}/synthesize`, { method: "POST" });
      if (res.ok) setSynthesis((await res.json()).synthesis);
    } finally {
      setSynthLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/people/${id}`);
      if (!res.ok) { setNotFound(true); return; }
      const data = await res.json();
      setDossier(data.dossier);
      setSynthesis(data.synthesis);
      if (!data.synthesis) generate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

      {/* AI synthesis — the centerpiece */}
      <Card className="mt-5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">✦ AI summary</h2>
          <div className="flex gap-2">
            <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={copyHooks}>Copy hooks</Button>
            <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={generate} disabled={synthLoading}>Regenerate</Button>
          </div>
        </div>
        {synthLoading && !synthesis ? (
          <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /></div>
        ) : synthesis && (synthesis.summary || synthesis.hooks.length) ? (
          <>
            <p className="text-sm text-neutral-800">{synthesis.summary}</p>
            {synthesis.interests.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {synthesis.interests.map((t) => <Badge key={t} className="bg-blue-50 text-blue-700">{t}</Badge>)}
              </div>
            )}
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
          <div className="text-sm text-neutral-500">Couldn&apos;t generate hooks. <button className="underline" onClick={generate}>Retry</button></div>
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
            {p.posts.map((post, i) => (
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}
