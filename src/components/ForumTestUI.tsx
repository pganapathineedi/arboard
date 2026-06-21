"use client";

import { useState, useRef } from "react";
import type { ImpactAnalysis } from "@/lib/types";

interface AgentOutput {
  agentId: string;
  agentName: string;
  role: string;
  content: string;
  complete: boolean;
  error?: string;
}

interface SSEEvent {
  type: string;
  sessionId?: string;
  agentCount?: number;
  agentId?: string;
  agentName?: string;
  role?: string;
  token?: string;
  error?: string;
  analysis?: ImpactAnalysis;
}

const RISK_COLORS: Record<string, string> = {
  critical: "text-red-400 border-red-400/30 bg-red-400/5",
  high:     "text-orange-400 border-orange-400/30 bg-orange-400/5",
  medium:   "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  low:      "text-green-400 border-green-400/30 bg-green-400/5",
};

const PRIORITY_COLORS: Record<string, string> = {
  required:    "bg-red-400/15 text-red-300",
  recommended: "bg-yellow-400/15 text-yellow-300",
  optional:    "bg-[#1e2a3a] text-[#8b949e]",
};

const DEFAULT_INPUT =
  "Build a Customer 360 self-service portal on Experience Cloud for B2C customers to view real-time SAP order status, submit service cases, and receive Einstein Bot-assisted case deflection. The portal integrates with SAP S/4HANA via MuleSoft Anypoint Platform. Order data (current and 24-month history) must be scoped to the authenticated customer's account only. Einstein Bots should handle initial case triage and deflect common queries before routing to human agents. The solution must support 50,000 active portal users and up to 10 million order records within 24 months of launch.";

export default function ForumTestUI() {
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [agents, setAgents] = useState<AgentOutput[]>([]);
  const [running, setRunning] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ImpactAnalysis | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    if (!input.trim() || running) return;

    setAgents([]);
    setSessionId(null);
    setAnalysis(null);
    setRunning(true);
    setAnalysing(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/forum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
        signal: abortRef.current.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: SSEEvent = JSON.parse(line.slice(6));
            handleEvent(event);
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("Stream error:", err);
      }
    } finally {
      setRunning(false);
      setAnalysing(false);
    }
  };

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case "analysis_start":
        setAnalysing(true);
        break;
      case "impact_analysis":
        setAnalysis(event.analysis ?? null);
        setAnalysing(false);
        break;
      case "analysis_error":
        setAnalysing(false);
        break;
      case "session_start":
        setSessionId(event.sessionId ?? null);
        break;
      case "agent_start":
        setAgents((prev) => [
          ...prev,
          { agentId: event.agentId!, agentName: event.agentName!, role: event.role!, content: "", complete: false },
        ]);
        break;
      case "token":
        setAgents((prev) =>
          prev.map((a) => a.agentId === event.agentId ? { ...a, content: a.content + event.token } : a)
        );
        break;
      case "agent_complete":
        setAgents((prev) =>
          prev.map((a) => a.agentId === event.agentId ? { ...a, complete: true } : a)
        );
        break;
      case "agent_error":
        setAgents((prev) =>
          prev.map((a) => a.agentId === event.agentId ? { ...a, complete: true, error: event.error } : a)
        );
        break;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="min-h-screen bg-[#07090f] text-white p-6 font-mono">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#00c8f0]">ARBoard</h1>
          <p className="text-[#8b949e] text-sm mt-1">Salesforce Architecture Review Board — powered by Claude AI</p>
          {sessionId && <p className="text-xs text-[#8b949e]/60 mt-1">Session: {sessionId}</p>}
        </div>

        {/* Input */}
        <textarea
          className="w-full h-40 bg-[#0d1117] border border-[#1e2a3a] rounded-lg p-4 text-sm text-white placeholder-[#8b949e] focus:outline-none focus:border-[#00c8f0] resize-none mb-4 transition-colors"
          placeholder="Describe your Salesforce architecture challenge or change request..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={running}
        />

        <div className="flex gap-3 mb-8">
          <button
            onClick={run}
            disabled={running || !input.trim()}
            className="px-6 py-2 bg-[#00c8f0] text-[#07090f] font-bold rounded-lg disabled:opacity-40 hover:bg-[#00b8e0] transition-colors text-sm"
          >
            {running ? "Running ARB Session..." : "Start ARB Session"}
          </button>
          {running && (
            <button
              onClick={stop}
              className="px-6 py-2 border border-[#1e2a3a] text-[#8b949e] rounded-lg hover:border-red-500 hover:text-red-400 transition-colors text-sm"
            >
              Stop
            </button>
          )}
        </div>

        {/* Impact Analysis Panel */}
        {analysing && !analysis && (
          <div className="border border-[#1e2a3a] rounded-lg p-4 mb-6 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#00c8f0] animate-pulse" />
            <span className="text-[#8b949e] text-sm">Analysing impact and selecting agents...</span>
          </div>
        )}

        {analysis && (
          <div className="border border-[#1e2a3a] rounded-lg overflow-hidden mb-8">
            <div className="flex items-center justify-between px-4 py-2 bg-[#0d1117] border-b border-[#1e2a3a]">
              <span className="text-[#00c8f0] text-sm font-bold">Impact Analysis</span>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded border ${RISK_COLORS[analysis.overallRisk]}`}>
                  {analysis.overallRisk.toUpperCase()} RISK
                </span>
                <span className="text-xs text-[#8b949e]">complexity: {analysis.estimatedComplexity}</span>
              </div>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-sm text-[#e6edf3] leading-relaxed">{analysis.summary}</p>

              {/* Activated Agents */}
              <div>
                <p className="text-xs text-[#8b949e] uppercase tracking-wider mb-2">Activated Agents</p>
                <div className="space-y-2">
                  {analysis.activatedAgents.map((a) => (
                    <div key={a.agentId} className="border border-[#1e2a3a] rounded p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[#00c8f0] text-xs font-bold">{a.agentName}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_COLORS[a.priority]}`}>
                          {a.priority}
                        </span>
                      </div>
                      <p className="text-xs text-[#8b949e] mb-1">{a.reason}</p>
                      <ul className="space-y-0.5">
                        {a.sfRisks.map((r, i) => (
                          <li key={i} className="text-xs text-[#e6edf3]/60 flex gap-1.5">
                            <span className="text-[#00c8f0]/50">›</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* Considerations */}
              {analysis.sfConsiderations.length > 0 && (
                <div>
                  <p className="text-xs text-[#8b949e] uppercase tracking-wider mb-2">Cross-Cutting Considerations</p>
                  <ul className="space-y-1">
                    {analysis.sfConsiderations.map((c, i) => (
                      <li key={i} className="text-xs text-[#e6edf3]/70 flex gap-1.5">
                        <span className="text-[#00c8f0]/50 shrink-0">›</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Agent Output Panels */}
        <div className="space-y-6">
          {agents.map((agent) => (
            <div key={agent.agentId} className="border border-[#1e2a3a] rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-[#0d1117] border-b border-[#1e2a3a]">
                <div>
                  <span className="text-[#00c8f0] text-sm font-bold">{agent.agentName}</span>
                  <span className="text-[#8b949e] text-xs ml-2">{agent.role}</span>
                </div>
                <span className="text-xs">
                  {agent.error ? (
                    <span className="text-red-400">Error</span>
                  ) : agent.complete ? (
                    <span className="text-green-400">Done</span>
                  ) : (
                    <span className="text-yellow-400 animate-pulse">Streaming...</span>
                  )}
                </span>
              </div>
              <div className="p-4 text-sm text-[#e6edf3] whitespace-pre-wrap leading-relaxed min-h-[60px]">
                {agent.error ? (
                  <span className="text-red-400">{agent.error}</span>
                ) : (
                  agent.content || <span className="text-[#8b949e]">Waiting...</span>
                )}
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
