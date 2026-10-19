import type { Cast } from '../../lib/types';
import { inline, paragraphs } from '../../lib/format';
import { CopyButton } from '../../components/ui';

export function TranscriptCard({ cast }: { cast: Cast }) {
  if (!cast.script && cast.status === 'ready') return null;

  return (
    <section className="transcript-card" aria-label="Narration transcript">
      <div className="transcript-header">
        <div>
          <h3>Narration transcript</h3>
          <p className="transcript-sub">Follow along or read the full spoken briefing</p>
        </div>
        {cast.script ? <CopyButton text={cast.script} label="Copy transcript" /> : null}
      </div>
      {cast.script ? (
        <div className="transcript-prose">
          {paragraphs(cast.script).map((p, i) => (
            <p key={i}>{inline(p)}</p>
          ))}
        </div>
      ) : (
        <p className="muted">Gemma is generating the narration script…</p>
      )}
    </section>
  );
}
