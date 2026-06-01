import { FlaskConical, ShieldCheck } from "lucide-react";
import { qualityDomains } from "@/lib/prismaData";
import { Badge, EmptyState } from "@/components/prisma-review-ui";

type RiskSectionProps = {
  studiesIncluded: number;
};

export function RiskSection({ studiesIncluded }: RiskSectionProps) {
  if (studiesIncluded === 0) {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Risk of bias</p>
            <h1>Quality Assessment</h1>
            <p className="subtle">Quality templates can be configured now; assessments start once studies are included.</p>
          </div>
        </section>
        <section className="panel">
          <EmptyState
            icon={ShieldCheck}
            title="No assessments assigned"
            description="Included studies will appear here for RoB 2, ROBINS-I, or custom quality assessment."
          />
        </section>
      </div>
    );
  }

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Risk of bias</p>
          <h1>Quality Assessment</h1>
          <p className="subtle">Templates are project-owned and can model RoB 2, ROBINS-I, or custom tools.</p>
        </div>
        <div className="segmented">
          <button className="active" type="button">RoB 2 Style</button>
          <button type="button">ROBINS-I</button>
          <button type="button">Custom</button>
        </div>
      </section>

      <section className="qualityGrid">
        {qualityDomains.map((domain) => (
          <article className="panel qualityPanel" key={domain.domain}>
            <div className="qualityHeader">
              <FlaskConical size={20} />
              <div>
                <h2>{domain.domain}</h2>
                <Badge label={domain.judgement} tone={domain.judgement === "High risk" ? "danger" : domain.judgement === "Some concerns" ? "warning" : "success"} />
              </div>
            </div>
            <p>{domain.support}</p>
            <div className="judgementRail">
              <span className={domain.judgement === "Low risk" ? "active low" : "low"}>Low</span>
              <span className={domain.judgement === "Some concerns" ? "active some" : "some"}>Some</span>
              <span className={domain.judgement === "High risk" ? "active high" : "high"}>High</span>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
