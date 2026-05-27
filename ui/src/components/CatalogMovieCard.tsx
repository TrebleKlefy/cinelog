import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MoviePoster } from "./MoviePoster";
import { formatRuntimeMinutes, getCatalogBadgeScore, getRottenTomatoesPercent, imdbBadgeTier, rtBadgeTier, type ExternalRatingDTO } from "../lib/movieDisplay";

type CatalogMovieCardProps = {
  title: string;
  posterUrl: string | null;
  runtimeMinutes?: number | null;
  externalRatings?: ExternalRatingDTO[];
  /** Wrapped card link when poster is not interactive (legacy one-tap navigate). */
  to?: string;
  /** Navigate from the title strip (recommended with `onPosterClick`). */
  detailHref?: string;
  /** Poster / upper card opens quick detail modal. Title uses `detailHref` or `to` when provided. */
  onPosterClick?: () => void;
  footer?: ReactNode;
};

export function CatalogMovieCard({
  title,
  posterUrl,
  runtimeMinutes,
  externalRatings,
  to,
  detailHref,
  onPosterClick,
  footer,
}: CatalogMovieCardProps) {
  const score = getCatalogBadgeScore(externalRatings);
  const tier = score != null ? imdbBadgeTier(score) : null;
  const rtPercent = getRottenTomatoesPercent(externalRatings);
  const rtTier = rtPercent != null ? rtBadgeTier(rtPercent) : null;
  const runtime = formatRuntimeMinutes(runtimeMinutes ?? null);

  const href = detailHref ?? to ?? undefined;

  const media = (
    <div className="catalog-card__media">
      {onPosterClick ? (
        <>
          <button
            type="button"
            className={`catalog-card__poster-hit${href ? " catalog-card__poster-hit--reserve-title" : ""}`}
            aria-label={`Details for ${title}`}
            onClick={onPosterClick}
          />
          <MoviePoster src={posterUrl} alt={title} />
          <div className="catalog-card__badges" aria-label="Metadata">
            {score != null && (
              <span className={`catalog-badge catalog-badge--rating catalog-badge--${tier}`}>{score.toFixed(1)}</span>
            )}
            {rtPercent != null && (
              <span className={`catalog-badge catalog-badge--rt catalog-badge--${rtTier}`} title="Rotten Tomatoes">
                {Math.round(rtPercent)}%
              </span>
            )}
            {runtime != null && <span className="catalog-badge catalog-badge--runtime">{runtime}</span>}
          </div>
          <div className={`catalog-card__titlebar${href ? " catalog-card__titlebar--linked" : ""}`}>
            {href ? (
              <Link to={href} className="catalog-card__title-link">
                <span className="catalog-card__title">{title}</span>
              </Link>
            ) : (
              <span className="catalog-card__title">{title}</span>
            )}
          </div>
          <div className="catalog-card__shine" aria-hidden />
        </>
      ) : (
        <>
          <MoviePoster src={posterUrl} alt={title} />
          <div className="catalog-card__badges" aria-label="Metadata">
            {score != null && (
              <span className={`catalog-badge catalog-badge--rating catalog-badge--${tier}`}>{score.toFixed(1)}</span>
            )}
            {rtPercent != null && (
              <span className={`catalog-badge catalog-badge--rt catalog-badge--${rtTier}`} title="Rotten Tomatoes">
                {Math.round(rtPercent)}%
              </span>
            )}
            {runtime != null && <span className="catalog-badge catalog-badge--runtime">{runtime}</span>}
          </div>
          <div className="catalog-card__titlebar">
            <span className="catalog-card__title">{title}</span>
          </div>
          <div className="catalog-card__shine" aria-hidden />
        </>
      )}
    </div>
  );

  const inner = (
    <article className={`catalog-card${footer ? " catalog-card--with-footer" : ""}`}>
      {media}
      {footer != null ? <div className="catalog-card__footer">{footer}</div> : null}
    </article>
  );

  /* Whole-card navigation when modal is not used */
  if (href && !onPosterClick) {
    return (
      <Link to={href} className="catalog-card-link">
        {inner}
      </Link>
    );
  }

  return inner;
}
