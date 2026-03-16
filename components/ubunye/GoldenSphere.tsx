'use client';

// Pre-computed deterministic dust particle values (avoids Math.random() hydration mismatch)
const DUST_PARTICLES: {
  angle: number;
  distance: number;
  duration: number;
  delay: number;
  size: number;
  opacity: number;
}[] = [
  { angle: 0,   distance: 47, duration: 5.2, delay: -1.3, size: 2.1, opacity: 0.55 },
  { angle: 30,  distance: 39, duration: 3.8, delay: -3.7, size: 2.8, opacity: 0.42 },
  { angle: 60,  distance: 53, duration: 6.1, delay: -0.9, size: 1.7, opacity: 0.65 },
  { angle: 90,  distance: 41, duration: 4.5, delay: -2.5, size: 3.1, opacity: 0.38 },
  { angle: 120, distance: 56, duration: 3.4, delay: -4.1, size: 2.4, opacity: 0.72 },
  { angle: 150, distance: 44, duration: 5.8, delay: -1.8, size: 1.9, opacity: 0.48 },
  { angle: 180, distance: 50, duration: 4.2, delay: -3.2, size: 2.6, opacity: 0.58 },
  { angle: 210, distance: 37, duration: 6.5, delay: -0.5, size: 3.3, opacity: 0.35 },
  { angle: 240, distance: 58, duration: 3.6, delay: -2.9, size: 2.0, opacity: 0.62 },
  { angle: 270, distance: 43, duration: 5.0, delay: -4.4, size: 2.7, opacity: 0.45 },
  { angle: 300, distance: 51, duration: 4.8, delay: -1.6, size: 1.8, opacity: 0.70 },
  { angle: 330, distance: 46, duration: 3.9, delay: -3.5, size: 3.0, opacity: 0.40 },
];

/**
 * CSS-only golden sphere with orbiting particles and ambient glow.
 * No Three.js — pure CSS animations for lighter, faster rendering.
 */
export function GoldenSphere({ className = '' }: { className?: string }) {
  return (
    <div className={`golden-sphere-container ${className}`}>
      {/* Ambient glow layers */}
      <div className="sphere-glow sphere-glow-outer" />
      <div className="sphere-glow sphere-glow-inner" />

      {/* Core sphere */}
      <div className="sphere-core" />

      {/* Orbiting particles — 3 rings at different angles */}
      <div className="orbit-ring orbit-ring-1">
        <div className="orbit-particle" />
        <div className="orbit-particle orbit-particle-delay-1" />
        <div className="orbit-particle orbit-particle-delay-2" />
      </div>
      <div className="orbit-ring orbit-ring-2">
        <div className="orbit-particle" />
        <div className="orbit-particle orbit-particle-delay-1" />
      </div>
      <div className="orbit-ring orbit-ring-3">
        <div className="orbit-particle" />
        <div className="orbit-particle orbit-particle-delay-2" />
      </div>

      {/* Floating dust particles — deterministic values, no hydration mismatch */}
      {DUST_PARTICLES.map((p, i) => (
        <div
          key={i}
          className="dust-particle"
          style={{
            '--dust-angle': `${p.angle}deg`,
            '--dust-distance': `${p.distance}%`,
            '--dust-duration': `${p.duration}s`,
            '--dust-delay': `${p.delay}s`,
            '--dust-size': `${p.size}px`,
            '--dust-opacity': `${p.opacity}`,
          } as React.CSSProperties}
        />
      ))}

      <style jsx>{`
        .golden-sphere-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* ── Ambient glow ── */
        .sphere-glow {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
        }
        .sphere-glow-outer {
          width: 100%;
          height: 100%;
          background: radial-gradient(circle, rgba(212,168,67,0.08) 0%, transparent 70%);
          animation: glow-breathe 4s ease-in-out infinite;
        }
        .sphere-glow-inner {
          width: 60%;
          height: 60%;
          top: 20%;
          left: 20%;
          background: radial-gradient(circle, rgba(212,168,67,0.15) 0%, transparent 70%);
          animation: glow-breathe 4s ease-in-out infinite 0.5s;
        }

        /* ── Core sphere ── */
        .sphere-core {
          position: absolute;
          width: 32%;
          height: 32%;
          border-radius: 50%;
          background: radial-gradient(
            circle at 35% 35%,
            rgba(232,201,106,0.9) 0%,
            rgba(212,168,67,0.7) 30%,
            rgba(180,140,50,0.4) 60%,
            rgba(140,100,30,0.1) 80%,
            transparent 100%
          );
          box-shadow:
            0 0 40px rgba(212,168,67,0.3),
            0 0 80px rgba(212,168,67,0.15),
            inset 0 0 20px rgba(255,255,255,0.1);
          animation: core-pulse 4s ease-in-out infinite;
        }

        /* ── Orbit rings ── */
        .orbit-ring {
          position: absolute;
          width: 75%;
          height: 75%;
          border-radius: 50%;
          border: 1px solid rgba(212,168,67,0.06);
        }
        .orbit-ring-1 {
          animation: orbit-spin 12s linear infinite;
          transform: rotateX(60deg) rotateZ(0deg);
        }
        .orbit-ring-2 {
          width: 58%;
          height: 58%;
          animation: orbit-spin 9s linear infinite reverse;
          transform: rotateX(75deg) rotateZ(45deg);
        }
        .orbit-ring-3 {
          width: 90%;
          height: 90%;
          animation: orbit-spin 16s linear infinite;
          transform: rotateX(45deg) rotateZ(-30deg);
          border-color: rgba(212,168,67,0.04);
        }

        /* ── Orbit particles ── */
        .orbit-particle {
          position: absolute;
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #D4A843;
          box-shadow: 0 0 6px rgba(212,168,67,0.8), 0 0 12px rgba(212,168,67,0.4);
          top: -1.5px;
          left: 50%;
          margin-left: -1.5px;
        }
        .orbit-particle-delay-1 {
          top: auto;
          bottom: -1.5px;
          left: 25%;
        }
        .orbit-particle-delay-2 {
          top: 50%;
          left: -1.5px;
        }

        /* ── Floating dust ── */
        .dust-particle {
          position: absolute;
          width: var(--dust-size);
          height: var(--dust-size);
          border-radius: 50%;
          background: rgba(212,168,67, var(--dust-opacity));
          box-shadow: 0 0 4px rgba(212,168,67,0.3);
          top: 50%;
          left: 50%;
          animation: dust-float var(--dust-duration) ease-in-out var(--dust-delay) infinite;
          transform: rotate(var(--dust-angle)) translateX(var(--dust-distance));
        }

        /* ── Keyframes ── */
        @keyframes glow-breathe {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.7; }
        }

        @keyframes core-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }

        @keyframes orbit-spin {
          0% { transform: rotateX(60deg) rotateZ(0deg); }
          100% { transform: rotateX(60deg) rotateZ(360deg); }
        }

        @keyframes dust-float {
          0%, 100% {
            opacity: var(--dust-opacity);
            transform: rotate(var(--dust-angle)) translateX(var(--dust-distance)) scale(1);
          }
          50% {
            opacity: calc(var(--dust-opacity) * 0.4);
            transform: rotate(calc(var(--dust-angle) + 20deg)) translateX(calc(var(--dust-distance) + 5%)) scale(0.7);
          }
        }
      `}</style>
    </div>
  );
}
