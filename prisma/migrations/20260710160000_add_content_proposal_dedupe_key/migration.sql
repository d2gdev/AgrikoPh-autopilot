-- Persist canonical Content Pilot identities so create races are idempotent.
-- For historical collisions, preserve the operator-decided (then oldest) row at
-- the canonical key and give later records a stable history suffix.
ALTER TABLE "ContentProposal" ADD COLUMN "dedupeKey" TEXT;

WITH normalized AS (
  SELECT
    "id",
    CASE
      WHEN NULLIF(btrim("articleHandle"), '') IS NOT NULL THEN
        lower(regexp_replace(btrim("proposalType"), '\s+', ' ', 'g')) ||
        ':article:' || lower(regexp_replace(btrim("articleHandle"), '\s+', ' ', 'g')) ||
        CASE
          WHEN lower(btrim("proposalType")) = 'internal-link' THEN
            ':to:' || lower(regexp_replace(btrim(COALESCE(
              NULLIF("proposedState"->>'toArticle', ''),
              NULLIF("proposedState"->>'targetArticle', ''),
              NULLIF("proposedState"->>'suggestedAnchorText', ''),
              "title"
            )), '\s+', ' ', 'g'))
          WHEN lower(btrim("proposalType")) = 'seo-fix' THEN
            ':action:' || lower(regexp_replace(btrim(COALESCE(
              NULLIF(concat_ws(':',
                COALESCE(
                  NULLIF("proposedState"->>'issue', ''),
                  NULLIF("proposedState"->>'action', '')
                ),
                NULLIF("proposedState"->>'targetQuery', '')
              ), ''),
              "title"
            )), '\s+', ' ', 'g'))
          ELSE ''
        END
      ELSE
        lower(regexp_replace(btrim("proposalType"), '\s+', ' ', 'g')) ||
        ':handleless:' || lower(regexp_replace(btrim(COALESCE(
          NULLIF("proposedState"->>'targetKeyword', ''),
          NULLIF("proposedState"->>'targetQuery', ''),
          NULLIF("proposedState"->>'suggestedTitle', ''),
          NULLIF("proposedState"->>'title', ''),
          "title"
        )), '\s+', ' ', 'g'))
    END AS canonical_key,
    "status",
    "createdAt"
  FROM "ContentProposal"
), ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY canonical_key
    ORDER BY
      CASE WHEN "status" IN ('approved','override_approved','published','rejected') THEN 0 ELSE 1 END,
      "createdAt" ASC,
      "id" ASC
  ) AS duplicate_rank
  FROM normalized
)
UPDATE "ContentProposal" AS proposal
SET "dedupeKey" = CASE
  WHEN ranked.duplicate_rank = 1 THEN ranked.canonical_key
  ELSE ranked.canonical_key || ':history:' || ranked."id"
END
FROM ranked
WHERE proposal."id" = ranked."id";

ALTER TABLE "ContentProposal" ALTER COLUMN "dedupeKey" SET NOT NULL;
DROP INDEX IF EXISTS "ContentProposal_active_action_dedupe_key";
CREATE UNIQUE INDEX "ContentProposal_dedupeKey_key" ON "ContentProposal"("dedupeKey");
