-- Admin editing and search demand (ADR-0285). `connectors` is an admin's
-- explicit choice of the connectors an Autohand listing works well with;
-- empty means the website infers them from the listing's words, as before.
-- search_queries counts marketplace searches per day by their normalised
-- text, and how many found nothing: what people look for that is missing.
-- No person, network or time finer than the day is kept.

ALTER TABLE listings ADD COLUMN connectors TEXT NOT NULL DEFAULT '[]';

CREATE TABLE search_queries (
  day TEXT NOT NULL,
  term TEXT NOT NULL,
  searches INTEGER NOT NULL DEFAULT 0,
  empty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, term)
);
CREATE INDEX search_queries_term ON search_queries(term, day);
