import { useState } from "react";

export function MoviePoster({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const [err, setErr] = useState(false);
  const cls = className ? `movie-poster ${className}` : "movie-poster";
  if (!src || err) {
    return (
      <div className={`movie-poster movie-poster--placeholder ${className ?? ""}`}>
        <span className="movie-poster__ph">{alt.trim().slice(0, 1) || "?"}</span>
      </div>
    );
  }
  return <img className={cls} src={src} alt="" loading="lazy" decoding="async" onError={() => setErr(true)} />;
}
