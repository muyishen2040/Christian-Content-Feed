# Glossary

Terms already settled in `AGENTS.md` and the docs. Add a term here when a decision fixes its meaning.

**Testimony.** A first-person story about God's work in the writer's life. Sermons, news, announcements, anything crisis-adjacent (routed to human review) and sources from 真耶穌教會 or 全能神 are not testimonies.

**Source.** A site or publication we link out to. Has a rights status; a new source starts as `pending`.

**Link-out.** We store a title, the source, the original URL, our own summary and tags, and nothing else. Article body text and author names are not stored by default. Storing permitted article text is a later decision (MUY-51).

**Rights status.** Whether we may use a source's content. Stays `pending` until a person decides. A permissive robots.txt or public availability is not permission.

**Review status.** Where a testimony is in human review (`pending` on arrival).

**Publication status.** Whether a testimony is visible. Importers and the loader only ever write `draft`; a person publishes.

**Importer.** Code that reads one source and writes a JSON batch. It checks robots.txt, rate-limits itself and classifies each item.

**Batch.** An importer's JSON output. A batch with `stats.complete` false is refused by the loader.

**Loader.** `pipeline/loader.py`. Writes a batch to the database as draft rows, idempotently, and never updates existing rows.

**Held for review.** A candidate the classifier will not accept on its own, for example crisis-like wording. A person decides.

Terms for anonymous sessions and consent are added once that work (MUY-26) is merged.
