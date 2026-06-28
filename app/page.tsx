"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PersonCard } from "../src/types";
import { Card, Badge, Button, Skeleton } from "../src/ui/primitives";

export default function Home() {
  const [people, setPeople] = useState<PersonCard[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  async function load() {
    const res = await fetch("/api/people");
    if (!res.ok) {
      setPeople([]);
      return;
    }
    const data = await res.json();
    setPeople(data.people ?? []);
  }
  useEffect(() => { load(); }, []);

  // Fix 1: clear interval on unmount to prevent leaks
  useEffect(() => () => clearInterval(pollRef.current), []);

  async function startRun() {
    if (!prompt.trim()) return;
    // Fix 3: guard against re-entry
    if (running) return;
    setRunning(true);
    setRunStatus("starting…");
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    // Fix 4: guard POST failure
    if (!res.ok) {
      setRunStatus("Error starting run.");
      setRunning(false);
      return;
    }
    const { jobId } = await res.json();
    // Fix 1: store interval in ref so cleanup effect can clear it
    pollRef.current = setInterval(async () => {
      // Fix 5: wrap poll body in try/catch
      try {
        const pollRes = await fetch(`/api/runs/${jobId}`);
        if (!pollRes.ok) throw new Error(`Poll failed: ${pollRes.status}`);
        const j = await pollRes.json();
        setRunStatus(`${j.status} — ${j.progress?.stage ?? ""} (${j.progress?.people ?? 0} people)`);
        if (j.status === "completed" || j.status === "failed") {
          clearInterval(pollRef.current);
          setRunning(false);
          load();
        }
      } catch {
        clearInterval(pollRef.current);
        setRunStatus("Polling error — run status unknown.");
        setRunning(false);
      }
    }, 2000);
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Prospect</h1>
        <div className="flex items-center gap-4">
          <Link href="/settings" className="text-sm text-blue-600 hover:underline">Sender profile →</Link>
          <Link href="/workspace" className="rounded-lg bg-[#F25C1F] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#DB4F15]">
            Open Champion Workspace →
          </Link>
        </div>
      </div>
      <p className="mb-6 text-sm text-neutral-500">Browse collected prospects and their cold-email hooks.</p>

      <div className="mb-6 flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='e.g. "Series A dev tool companies"'
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        {/* Fix 3: disable button while running */}
        <Button onClick={startRun} disabled={running}>Run</Button>
      </div>
      {runStatus && <p className="mb-4 text-sm text-neutral-600">{runStatus}</p>}

      {people === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : people.length === 0 ? (
        <p className="text-sm text-neutral-500">No people yet. Run a prompt above.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => (
            <Link key={p.id} href={`/people/${p.id}`}>
              <Card className="h-full p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{p.name}</div>
                  {p.isInfluencer && <Badge className="bg-amber-100 text-amber-800">Top Voice</Badge>}
                </div>
                <div className="text-sm text-neutral-600">{p.title}</div>
                <div className="text-xs text-neutral-400">@{p.companyDomain}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.skills.slice(0, 5).map((s) => <Badge key={s}>{s}</Badge>)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
