# MCP spike: Track Record as a server Claude calls

**Status:** spike. First proven locally on 2026-11-14, then rebased onto `develop` at `5915c35` and proven
again. It isn't a finished feature and isn't in the decision log yet.

## Why

Track Record calls the Anthropic API itself (`src/model/providers/anthropic.ts`). One full set of renders
cost about $130. The author already pays for Claude Max, and Anthropic doesn't allow a subscription's login
to be embedded in a third-party app. So this spike turns the design around: Track Record exposes the record
over MCP, and Claude (Desktop, Code, or a claude.ai custom connector) does the writing on the author's own plan.

## What was built

`src/mcp/server.ts` builds an `McpServer` (`@modelcontextprotocol/sdk` 1.32.2) bound to one user id.
`scripts/mcp-server.ts` (`npm run mcp`) runs it over stdio against a local database.

| Tool | What it does | Reused from |
| --- | --- | --- |
| `get_record(document)` | The record for one document (a kind, or a tailored document's id): the facts and spec the model seam is sent, held to the same budget; `instructions`, the generator's own system prompt for it; counts of what was withheld; and a list of every document | `resolveRender`, `requireProfile`, `tailoringOf`, `collectRenderInputs({ forModel: true })`, `buildGenerationPrompt`, `renderState` |
| `list_sources()` | Source document ids and filenames | — |
| `get_source(source_document_id)` | The extracted text of the latest version, which quotes are copied from | — |
| `add_fact(claim, quote, source_document_id, technologies, grade?)` | Adds a fact the way the importer does. The quote must match the source exactly; a quote that doesn't match is refused and nothing is stored. A repeat of a fact already in the record is refused. Otherwise the fact is accepted with the caller's grade, filtered through the importer's floor, and flagged where needed | `anchorQuote`, `dedupeHash`, `sortFact` |
| `save_render(document, content)` | Stores `RenderContent` as a ready proposal, after the generate route's refusals and the generator's own post-model checks | `requireRenderable`, `refuseUngeneratable`, `parseEditedContent`, `badCitations`, `linesToShorten`, `isStoryComplete`, `settleContent`, `openProposal`, `editWarnings`, `rirekishoWarnings` |
| `story_part(document, story_so_far?, part?)` | Writes a career story a part at a time, as the generator does: each employer chapter alone with only its facts, then the chapters of no employer, then the closing tables. Each call returns the next part's chapters, the generator's prompt for that part and the facts it may cite. Each part is checked as it arrives (its chapters, its citations, the Japanese check), and the joined story is held to the whole plan | `employerParts`, `framingCall`, `closingCall`, `chaptersOf`, `buildGenerationPrompt`, `parseRenderContent`, `japaneseDefect`, `parseGeneratedRender` |
| `get_instructions(job)` | The app's own system prompt for one model job (`extract`, `read_posting`, `capture`, `explain_flag`, `grade`), and which tool saves its answer here. `capture` also gets the employers and projects to match names against | `EXTRACTION_SYSTEM_PROMPT`, `READ_POSTING_SYSTEM_PROMPT`, `CAPTURE_SYSTEM_PROMPT`, `EXPLAIN_SYSTEM_PROMPT`, `GRADING_SYSTEM_PROMPT` |
| `list_applications()` / `add_application(...)` | Lists applications with their tailored documents, and adds one at Not applied from a posting Claude read and the author confirmed | `createBody`, `createApplication` |
| `tailor_document(application_id, kind)` | Gives an application its own English résumé or 履歴書 and puts it on the application; the returned id is the `document` for `get_record` | `addTailored` |
| `capture_facts(claims)` | Saves claims the author typed and confirmed, Attested with no quote, as quick capture does | `saveBody`, `saveCaptured` |
| `list_flags()` / `explain_flag(flag_id, explanation)` | Open flags with their facts, and stores the explanation Claude wrote where Explain this shows it. A flag already explained keeps its explanation | `factOfFlag`, `requireFlag`, `storeExplanation` |
| `list_waiting_facts()` / `grade_facts(grades)` | Facts waiting from before the importer graded, and accepts them with Claude's grades through Sort's own code: kept Private when confidential, Measured only with a passage, flagged and checked for repeats | `SORT_BATCH`, `applyGrades` |

Extractions keep it to one code path rather than a fork. The routes' own zod schemas validate the job tools'
input, so a value the screen refuses is refused in the same words. Each route below now calls the function
its body became:

- `routes/applications.ts`: `createApplication`. `routes/application-documents.ts`: `addTailored`.
  `routes/capture.ts`: `saveCaptured`. `routes/flags.ts`: `storeExplanation` (and `requireFlag`, exported).
  `routes/facts.ts`: `applyGrades`, the write half of `POST /api/facts/sort`.

The first two, from the spike:

- **`src/server/services/render-state.ts`** holds what used to live privately in `routes/renders.ts`:
  `renderState`, `usableFacts`, `waitingProposalId`, `ensureRender`. It also holds three functions the
  generate route's inline code became: `requireRenderable` (buildable, then waiting proposal, then profile, in
  the route's order), `refuseUngeneratable` (résumé job headers, no usable facts) and `openProposal` (render
  row, insert, unique-index race). The route re-exports `renderState` and `usableFacts` for its existing importers.
- **`settleContent` in `src/server/services/render.ts`** holds the deterministic checks `generateIntoProposal`
  ran after the model returned: stripping unknown citations, assembling the 職務経歴書's record rows, the
  English and Japanese defect checks, the tailored 履歴書's 志望動機 and 本人希望欄, and marking drafts. The
  generator calls it and keeps its retry on a named defect. `save_render` calls it and refuses on any failure.

### How the invariants hold

- **Every query filters by `user_id`.** The id is fixed when the server starts (`--user <email>`) and no tool
  takes it as an argument. `resolveRender` filters a tailored id by user too. A test checks that a second
  user's server gets `not found` for the first user's source.
- **Verbatim quotes.** `add_fact` anchors against `source_document_versions.extracted_text` with the import
  pipeline's own `anchorQuote`.
- **Generated and Private facts never reach a render.** `get_record` returns only what `collectRenderInputs`
  passes, so withheld facts' claims never appear in the payload. `save_render` refuses any content that cites
  a fact that is Private, Generated, not accepted, unknown, or not given for that document. It also creates a
  *proposal*, never a version, so the author's accept in the app remains the only way a document changes.
- **Grading follows the importer's rules** (decision log 2026-10-08): a fact is never Public. The scrub is a
  floor, so a confidential shape is Private whatever the grade. Measured needs a passage, and an ungraded fact
  is kept Generated and flagged. A fact Claude grades Measured or Attested and doesn't mark confidential is
  usable by the next document, as an imported one is. That replaces this spike's first rule ("Generated
  candidate"), which predated automatic acceptance and would have left Claude's facts in a queue the app no
  longer has.
- **No source text in logs.** stdout is the protocol. The entry redirects `console.log` to stderr. The only log
  lines are `mcp_ready` (a user id) and `mcp_tool_failed` (a tool name).

## Try it

The server refuses any database that isn't local, and it refuses `track_record_test`. With no
`--database-url` it reads `DATABASE_URL` from `.dev.vars`. **That database, `track_record_dev`, holds a copy
of the author's real record**, so try the invented demo first. The demo runs on a separate compose project,
which keeps it off the shared `track-record_pgdata` volume.

### An invented demo record on its own stack

Write an override that moves both ports, for example to `compose.mcp.yml` outside the repo:

```yaml
services:
  postgres:
    ports: !override ["55432:5432"]
  neon-proxy:
    ports: !override ["54444:4444"]
```

```bash
docker compose -p trmcp -f docker-compose.yml -f /path/to/compose.mcp.yml up -d --wait
```

```bash
docker exec -i trmcp-postgres-1 psql -U postgres -c "create database track_record_mcp_demo"
```

```bash
cat src/server/db/migrations/*.sql | docker exec -i trmcp-postgres-1 psql -q -v ON_ERROR_STOP=1 -U postgres -d track_record_mcp_demo
```

```bash
npx tsx scripts/mcp/seed-demo.ts 'postgresql://postgres:postgres@localhost:55432/track_record_mcp_demo?sslmode=disable&proxyPort=54444'
```

The seed adds an invented person with four accepted facts, one per gate: Measured/Public, Attested/Restricted,
Measured/Private and Generated/Public. It refuses any database whose name doesn't end in `_demo`.

### Claude Code

```bash
claude mcp add track-record -- /ABSOLUTE/PATH/TO/track-record/scripts/mcp/run.sh --database-url 'postgresql://postgres:postgres@localhost:55432/track_record_mcp_demo?sslmode=disable&proxyPort=54444' --user mcp-demo@example.invalid
```

Drop `--database-url` to use `.dev.vars`'s database. Drop `--user` if that database holds exactly one user.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "track-record": {
      "command": "/ABSOLUTE/PATH/TO/track-record/scripts/mcp/run.sh",
      "args": ["--user", "you@example.com"]
    }
  }
}
```

`run.sh` changes to the repo root before starting `tsx`, because clients launch servers from a directory of
their own and `tsx` reads the `~/` alias from the working directory's `tsconfig.json`. Without it, the client
reports `Connection closed`. It needs `node` on the PATH that Claude Desktop starts it with.
`scripts/mcp/data-hooks.mjs` gives Node the `.docx` and `.ttf` imports that wrangler loads as `Data` modules.

### Then

Ask Claude to call `get_record` for a document, write it, and `save_render` it. Open Track Record and review
the proposal on the document's page, as you would one the app generated itself.

Or use **Open in Claude** on a document's card on Home (`src/client/components/open-in-claude.tsx`). It is
Claude Desktop's documented deep link, `claude://claude.ai/new?q=<prompt>`, with that prompt typed in for the
card's document ref; the author reads it and presses Send. It is shown only in a development build
(`import.meta.env.DEV`), because the server is local and reads the local database, and only where `save_render`
could open a proposal (buildable, none waiting or being written). The link cannot install the server: without
the config above, Claude answers that it has no Track Record tools. The web form, `claude.ai/new?q=`, is not
documented and is not used. A production build would show it once a remote connector exists.

## What the demonstration showed (after the rebase)

`claude -p` (Sonnet, run under the author's plan) was connected to the server against the demo database.

**Guided run, before `instructions` existed:**

1. `get_record("english_resume")` returned 2 of the 4 facts, `withheld: { private: 1, generated: 1, overBudget: 0 }`.
2. `save_render` stored a two-bullet section as a `ready` proposal. Told only to write a "projects" section,
   Claude filed employer facts under Projects, which the register says not to do.
3. `add_fact` with a paraphrased quote was refused ("does not appear verbatim … Nothing was stored").

**Open run, with `instructions`:** asked only to "write my English résumé and save it", Claude produced the
generator's structure: a summary, and a section keyed `employer:emp_mcp_demo` with each fact under its
employer. `save_render` accepted it on the first try, with no warnings.

Before the employer had a city, `save_render` was refused with upstream's résumé precondition
("… needs a city"), which is the generate route's own refusal reaching the MCP caller.

`tests/mcp.test.ts` (14 tests, a real MCP client over `InMemoryTransport`) covers:

- eligibility filtering, and a refusal without the required profile fields
- a graded fact accepted and usable at once, an ungraded fact kept Generated and flagged, and a confidential one kept Private
- a refused non-verbatim quote, a refused duplicate, and isolation between users
- a proposal accepted through `POST /api/proposals/:id/accept`
- refusals for Private, Generated and ungiven citations
- an English résumé in Japanese refused by the generator's own check
- the one-waiting-proposal rule

## Findings

- **Claude needs the generator's brief, not just the register.** Without it, Claude wrote an employer heading
  the attribution check couldn't match, and later filed employer facts under Projects. `get_record` now returns
  `buildGenerationPrompt(spec)`, the same system prompt `generateRender` sends, and the open run above came out
  right the first time. A career story is written with `story_part`, a part at a time, with each part's own
  prompt from the generator's own planning functions (`get_record` says so with `writeInParts`).
- **`get_source` sends source text to Claude.** That's the same exposure as the import pipeline, which sends
  chunks to Anthropic today, but this time it goes to whatever client the author connects.
- **The generator's repair loops become refusals.** Lines too long, a career story missing a chapter, and a
  language defect are each written again by the generator. The caller here is told what's wrong and writes it
  again. That works for Claude; it's also the one place behaviour differs from the generate route.

## What upstream changed that the MCP design now has to cover

The seam has grown from two functions to seven (`ModelSeam` in `src/model/types.ts`). Every one the author
starts by hand now has a way through MCP:

| Seam function | Covered by |
| --- | --- |
| `generateRender` | `get_record` + `save_render`; a career story through `story_part` |
| `extractFacts` | `get_instructions("extract")` + `get_source` + `add_fact`, one fact per call |
| `gradeFacts` | `add_fact`'s grade for new facts; `list_waiting_facts` + `grade_facts` for old ones |
| `shortenResumeLines` | A refusal from `save_render`; Claude writes the lines again |
| `readPosting` | `get_instructions("read_posting")` + `add_application` |
| `explainFlag` | `list_flags` + `explain_flag` |
| `captureClaims` | `get_instructions("capture")` + `capture_facts` |

- **Tailored documents** are addressed by their id. `document` accepts one, and `get_record`'s `documents`
  lists them. `add_application` and `tailor_document` create them.
- **A tailored 履歴書 lands with drafts.** `settleContent` marks the 志望動機 and 本人希望欄 as drafts, so
  the proposal can't be accepted until the author confirms each one. That's the same gate as a generated one,
  and it's intended.
- **Application steps** (status, documents sent, 履歴書 choice) have no tools. They're the author's own actions and
  don't need a model; leaving them in the app is the right default. So is marking a flag checked.
- **Where the author confirms on screen, Claude asks in chat.** Reading a posting and capturing a note both
  store nothing until the author has checked what was read. `get_instructions` tells Claude to show the
  author first and save only what they confirm; captured claims are saved as Attested on that word.

## The claude.ai connector

The same server, reachable from claude.ai, Claude Desktop and the phone with no local setup (decision log
2026-11-17). Built on the existing auth rather than beside it:

- **Endpoint.** `POST /api/mcp` on the Worker (`src/server/routes/mcp.ts`): Streamable HTTP, stateless, one
  `createTrackRecordServer` per request, bound to the user the access token was issued to.
- **Authorization server.** Better Auth's `@better-auth/mcp` plugin with `jwt` (`createAuth` in
  `src/server/auth.ts`): dynamic client registration at `/api/auth/oauth2/register`, PKCE, a `record` scope,
  JWT access tokens bound to `/api/mcp`, refresh tokens. The Google sign-in and the allowlist are the login;
  the SPA's `/consent` screen is where the author allows a client.
- **Discovery.** The Worker answers `/.well-known/oauth-protected-resource[/api/mcp]` and
  `/.well-known/oauth-authorization-server/api/auth` (`DISCOVERY_PATHS` in `src/server/index.ts`); a request
  without a token gets a `401` whose `WWW-Authenticate` points at the first.
- **Token check.** Signed by a key in `jwks`, read in-process; this deployment's issuer; audience `/api/mcp`;
  the `record` scope (a `403 insufficient_scope` without it); a user who still exists and is still on the
  allowlist.
- **Tests.** `tests/mcp-connector.test.ts` walks claude.ai's path with the suite's stand-in for Google:
  discovery, registration, authorize while signed out, sign-in, consent, token, then `initialize`,
  `tools/list` and a tool call. Missing, altered and out-of-scope tokens are refused.

### Connecting

Once deployed: add a custom connector in claude.ai's connector settings, with the URL
`https://<the workers.dev address>/api/mcp`. claude.ai registers itself, opens Track Record's sign-in, and
then the consent screen. Claude Code: `claude mcp add --transport http track-record https://<address>/api/mcp`.

### Still open

- **Revocation.** An access token is a JWT and holds until it expires. There is no screen listing connected
  clients or revoking their refresh tokens yet.
- **Claude Code over HTTP.** The provider registers an `http://localhost` redirect only for a client that
  says `application_type: "native"`; a web client must use HTTPS. claude.ai's callback is HTTPS. Whether Claude
  Code's registration says native is unverified; the local stdio server remains its path until it is.
- **Labelling.** A proposal saved over MCP looks like any other on the diff screen; a reason such as "Saved from
  Claude" would say where it came from.
- **Model seam.** Moving generation from the API to the author's own Claude changes the stack decision that
  names the model seam. The app still calls the API when the author presses Generate; the connector is a
  second path, not a replacement.
