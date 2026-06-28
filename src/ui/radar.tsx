"use client";

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import type { InterestAxis } from "../types";

export function InterestRadar({
  data,
  stroke = "#2563eb",
  fill = "#3b82f6",
  height = 300,
  tickFill = "#525252",
}: {
  data: InterestAxis[];
  stroke?: string;
  fill?: string;
  height?: number;
  tickFill?: string;
}) {
  if (!data.length) return null;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid />
          <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: tickFill }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="score" stroke={stroke} fill={fill} fillOpacity={0.4} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
