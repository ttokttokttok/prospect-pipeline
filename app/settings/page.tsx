"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SenderProfile } from "../../src/types";
import { Button } from "../../src/ui/primitives";

const EMPTY: SenderProfile = { senderName: "", senderCompany: "", offer: "", valueProp: "", socialProof: "", cta: "", tone: "" };
const FIELDS: { key: keyof SenderProfile; label: string; placeholder: string; textarea?: boolean }[] = [
  { key: "senderName", label: "Your name", placeholder: "Sam Rivera" },
  { key: "senderCompany", label: "Company / role", placeholder: "DeployCo — Founder" },
  { key: "offer", label: "What you're offering", placeholder: "a faster CI/CD platform", textarea: true },
  { key: "valueProp", label: "Value prop", placeholder: "cuts build times ~60%", textarea: true },
  { key: "socialProof", label: "Social proof", placeholder: "used by Stripe, Vercel; YC-backed", textarea: true },
  { key: "cta", label: "Call to action", placeholder: "open to a quick 15-min call?" },
  { key: "tone", label: "Tone", placeholder: "warm and direct, no corporate fluff" },
];

export default function SettingsPage() {
  const [profile, setProfile] = useState<SenderProfile>(EMPTY);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => { if (d.profile) setProfile({ ...EMPTY, ...d.profile }); });
  }, []);

  async function save() {
    setSaved(false);
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
    if (res.ok) setSaved(true);
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href="/" className="text-sm text-neutral-500">← Back</Link>
      <h1 className="mt-3 mb-1 text-2xl font-bold">Sender profile</h1>
      <p className="mb-6 text-sm text-neutral-500">Set once — used to draft every cold email.</p>
      <div className="space-y-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-sm font-medium">{f.label}</span>
            {f.textarea ? (
              <textarea
                value={profile[f.key]} placeholder={f.placeholder} rows={2}
                onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            ) : (
              <input
                value={profile[f.key]} placeholder={f.placeholder}
                onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            )}
          </label>
        ))}
        <div className="flex items-center gap-3">
          <Button onClick={save}>Save</Button>
          {saved && <span className="text-sm text-green-600">Saved ✓</span>}
        </div>
      </div>
    </main>
  );
}
