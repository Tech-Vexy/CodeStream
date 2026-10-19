import type { ChangeReport, CodebaseReport, Report, Risk } from '../../lib/types';
import { inline, paragraphs } from '../../lib/format';
import { Icon } from '../../components/icons';
import type { IconName } from '../../components/icons';
import { Sev } from '../../components/ui';

/* Building blocks ----------------------------------------------------------- */

function SectionCard({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <section className="report-card">
      <div className="report-head">
        <span className="report-icon">
          <Icon name={icon} size={15} />
        </span>
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Prose({ text }: { text: string | undefined }) {
  return (
    <div className="report-prose">
      {paragraphs(text).map((p, i) => (
        <p key={i}>{inline(p)}</p>
      ))}
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="report-chips">
      {items.map((item) => (
        <span className="chip" key={item}>
          {item}
        </span>
      ))}
    </div>
  );
}

function PathList({ paths }: { paths: string[] | undefined }) {
  if (!paths?.length) return null;
  return (
    <div className="paths">
      {paths.map((p) => (
        <code key={p}>{p}</code>
      ))}
    </div>
  );
}

/* Risks ---------------------------------------------------------------------- */

export function RiskAlert({ risks }: { risks: Risk[] }) {
  if (!risks.length) return null;
  const high = risks.filter((r) => r.severity.toLowerCase() === 'high' || r.severity.toLowerCase() === 'critical');
  const rest = risks.filter((r) => !high.includes(r));

  return (
    <>
      {high.length > 0 && (
        <section className="risk-alert-card" aria-label="High-severity risks">
          <div className="risk-alert-head">
            <span className="risk-alert-icon">
              <Icon name="alert" size={17} />
            </span>
            <h4>High-severity risks flagged</h4>
          </div>
          <ul className="risk-alert-list">
            {high.map((risk, i) => (
              <li className="risk-alert-item" key={i}>
                <strong>{risk.title}</strong>
                <p>{inline(risk.detail)}</p>
                <PathList paths={risk.paths} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {rest.length > 0 && (
        <SectionCard icon="shield" title="Other risks worth a look">
          <ul className="risk-plain-list">
            {rest.map((risk, i) => (
              <li key={i}>
                <div className="risk-plain-head">
                  <Sev severity={risk.severity} />
                  <strong>{risk.title}</strong>
                </div>
                <p>{inline(risk.detail)}</p>
                <PathList paths={risk.paths} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </>
  );
}

/* Codebase tour --------------------------------------------------------------- */

function CodebaseSections({ report }: { report: CodebaseReport }) {
  return (
    <>
      <SectionCard icon="sparkles" title="At a glance">
        <Prose text={report.tldr} />
        {report.techStack.length > 0 && (
          <>
            <h4 className="report-subhead">Tech stack</h4>
            <Chips items={report.techStack} />
          </>
        )}
      </SectionCard>

      {report.architecture && (
        <SectionCard icon="folder" title="Architecture">
          <Prose text={report.architecture} />
        </SectionCard>
      )}

      {report.components.length > 0 && (
        <SectionCard icon="list" title="Component responsibilities">
          <ul className="component-list">
            {report.components.map((c) => (
              <li key={c.name}>
                <strong>{c.name}</strong>
                <p>{inline(c.responsibility)}</p>
                <PathList paths={c.paths} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {report.dataFlow && (
        <SectionCard icon="activity" title="Data flow">
          <Prose text={report.dataFlow} />
        </SectionCard>
      )}

      {report.entryPoints.length > 0 && (
        <SectionCard icon="file" title="Entry points">
          <ul className="plain-list">
            {report.entryPoints.map((e) => (
              <li key={e.path}>
                <code>{e.path}</code>
                <span> — {inline(e.description)}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {report.readingOrder.length > 0 && (
        <SectionCard icon="book-open" title="Suggested reading order">
          <ol className="reading-list">
            {report.readingOrder.map((r, i) => (
              <li key={i}>
                <code>{r.path}</code>
                <p>{inline(r.why)}</p>
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      {report.openQuestions.length > 0 && (
        <SectionCard icon="help-circle" title="Open questions">
          <ul className="plain-list">
            {report.openQuestions.map((q, i) => (
              <li key={i}>{inline(q)}</li>
            ))}
          </ul>
        </SectionCard>
      )}
    </>
  );
}

/* Change review ----------------------------------------------------------------- */

function ChangeSections({ report }: { report: ChangeReport }) {
  return (
    <>
      <SectionCard icon="sparkles" title="What changed">
        <Prose text={report.overview} />
      </SectionCard>

      {report.highlights.length > 0 && (
        <SectionCard icon="list" title="Top changes">
          <ul className="component-list">
            {report.highlights.map((h, i) => (
              <li key={i}>
                <strong>{h.title}</strong>
                <p>{inline(h.detail)}</p>
                <PathList paths={h.paths} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {report.testing && (
        <SectionCard icon="check" title="Testing coverage">
          <Prose text={report.testing} />
        </SectionCard>
      )}

      {report.reviewChecklist.length > 0 && (
        <SectionCard icon="shield" title="Before you trust it — review checklist">
          <ul className="checklist">
            {report.reviewChecklist.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </ul>
        </SectionCard>
      )}

      {report.timeline.length > 0 && (
        <SectionCard icon="git-branch" title="Commit timeline">
          <ol className="timeline">
            {report.timeline.map((t, i) => (
              <li key={i}>
                <code>{t.sha}</code>
                <span>{inline(t.summary)}</span>
              </li>
            ))}
          </ol>
        </SectionCard>
      )}
    </>
  );
}

export function ReportSections({ report }: { report: Report | undefined }) {
  if (!report) return null;
  return (
    <>
      <h3 className="report-divider">
        <span>Analysis report</span>
      </h3>
      {'techStack' in report ? <CodebaseSections report={report as CodebaseReport} /> : <ChangeSections report={report as ChangeReport} />}
      <RiskAlert risks={report.risks} />
    </>
  );
}
