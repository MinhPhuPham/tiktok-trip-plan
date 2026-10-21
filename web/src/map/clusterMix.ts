export interface ClusterMember {
  category: string;
  priority: string | null;
}

export interface ClusterMix {
  total: number;
  /** conic-gradient stops, largest category first: "#hex 0.0deg 120.0deg, …". */
  ring: string;
  hasMust: boolean;
  /** Icon size in px: 34 below 10 members, 40 below 40, else 46. */
  size: number;
}

export function clusterSize(total: number): number {
  return total < 10 ? 34 : total < 40 ? 40 : 46;
}

/** The category mix a cluster shows as its ring, plus whether it hides a must-go place. */
export function clusterMix(members: readonly ClusterMember[], colorOf: (category: string) => string): ClusterMix {
  const counts = new Map<string, number>();
  let hasMust = false;
  for (const member of members) {
    const color = colorOf(member.category);
    counts.set(color, (counts.get(color) ?? 0) + 1);
    if (member.priority === "must") hasMust = true;
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const total = members.length;
  let acc = 0;
  const ring = sorted
    .map(([color, n]) => {
      const from = (acc / total) * 360;
      acc += n;
      return `${color} ${from.toFixed(1)}deg ${((acc / total) * 360).toFixed(1)}deg`;
    })
    .join(",");
  return { total, ring, hasMust, size: clusterSize(total) };
}
