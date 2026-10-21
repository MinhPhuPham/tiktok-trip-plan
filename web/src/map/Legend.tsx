import { useTripModel, useTripPlan } from "../data/hooks";
import { pinSize } from "../data/priority";
import type { Priority } from "../data/types";
import { useT } from "../i18n/useT";
import { safeColor } from "../lib/color";
import { cssVars } from "../lib/css";
import { Icon } from "../ui/Icon";
import { clusterMix } from "./clusterMix";

const LEVELS: readonly Priority[] = ["must", "high", "medium", "low"];
const legendSize = (level: Priority) => `${pinSize(level) * 0.6}px`;

/** What the pins, clusters, rays, lines and dots mean (inside the layers popover). */
export function Legend() {
  const t = useT();
  const model = useTripModel();
  const plan = useTripPlan();
  const { data } = model;
  const hasMust = model.places.some((p) => p.priority === "must");
  const levels = LEVELS.filter((level) => level !== "must" || hasMust);
  const categories = model.presentCategories;
  const ring = clusterMix(
    model.places.map((p) => ({ category: p.category, priority: null })),
    model.categoryColor,
  ).ring;
  return (
    <div className="legend">
      {data.center ? (
        <div className="lg">
          <span className="lg-center" style={cssVars({ "--cc": safeColor(data.center_color) })} />
          {`${t.t("center")}: ${t.loc(data.center.source)}`}
        </div>
      ) : null}
      <div className="legend-grid">
        {categories.map((category) => (
          <div key={category} className="lg">
            <span className="lg-pin" style={cssVars({ "--c": model.categoryColor(category), "--ink": model.categoryInk(category) })}>
              <Icon name={category} />
            </span>
            {t.category(category)}
          </div>
        ))}
      </div>
      <div className="lg gap">
        <span className="lg-cluster" style={cssVars({ "--ring": `conic-gradient(${ring})` })} aria-hidden="true" />
        {t.t("cluster_legend")}
      </div>
      <div className="lg gap">{t.t("pin_size")}</div>
      <div className="legend-grid">
        {levels.map((level) => (
          <div key={level} className="lg">
            <span className="lg-size">
              <span className={level === "must" ? "must" : undefined} style={{ width: legendSize(level), height: legendSize(level) }} />
            </span>
            {t.priority(level)}
          </div>
        ))}
      </div>
      {plan.days.length ? (
        <div className="legend-grid gap">
          {plan.days.map((day) => (
            <div key={day.day} className="lg">
              <span className="lg-line" style={cssVars({ "--d": day.color })} />
              {t.dayName(day.day)}
            </div>
          ))}
        </div>
      ) : null}
      {data.nearby.length ? (
        <div className="lg">
          <span className="lg-near" />
          {t.t("nearby")}
        </div>
      ) : null}
    </div>
  );
}
