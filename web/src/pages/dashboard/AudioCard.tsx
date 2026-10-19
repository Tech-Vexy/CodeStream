import type { Cast } from '../../lib/types';
import { audioUrl } from '../../lib/api';
import { WaveformPlayer } from '../../components/WaveformPlayer';
import { Icon } from '../../components/icons';

export function AudioCard({ cast }: { cast: Cast }) {
  return (
    <section className="audio-hero-card" aria-label="Audio briefing">
      <div className="audio-hero-header">
        <div className="audio-hero-title">
          <span className="audio-icon">
            <Icon name="headphones" size={18} />
          </span>
          <h3>Audio summary</h3>
        </div>
        <span className="pill ready">ElevenLabs narration</span>
      </div>

      {cast.hasAudio ? (
        <WaveformPlayer src={audioUrl(cast.id)} />
      ) : cast.status === 'queued' || cast.status === 'running' ? (
        <div className="audio-generating">
          <div className="soundwave-anim" aria-hidden="true">
            <span className="bar" />
            <span className="bar" />
            <span className="bar" />
            <span className="bar" />
            <span className="bar" />
          </div>
          <p className="generating-text">
            Gemma is analyzing the code and ElevenLabs is generating your audio summary…
          </p>
        </div>
      ) : (
        <p className="muted">Audio was not generated for this summary.</p>
      )}
    </section>
  );
}
