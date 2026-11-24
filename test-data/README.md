# Lie Hard Live — test show

Everything needed to run a full test show on https://lie-hard-live.web.app.
Use the **3players** files with 3 players, the **4players** files with 4.
Player names in setup can be anything; the CSVs match on `player_id`.

| Round | What to load | Answers |
|---|---|---|
| Warm-up | `warmup.csv` | 2 and 4 are LIES |
| Segment 1 | `segment1_3players.csv` / `segment1_4players.csv` | P2 lies (and P4 in the 4-player file) |
| Imposter | Typed in setup (below) | Ravi has the empty box |
| Segment 2 | `segment2_3players.csv` / `segment2_4players.csv` | P1 #2, P2 #3, P3 #1, P4 #1 are the lies |
| Segment 3 | Photo + title in setup (below) | Operator picks the winner |

## Segment 3 (no CSV)

In setup: any photo of an object, title **A vintage wristwatch**.
During the round, type a claim for each player, e.g. "It was my grandfather's".

## Imposter round (no CSV)

In setup, under **Imposter round — title & crowd names**:

- Title: `Brand Imposter`
- Names: `Asha`, `Ravi`, `Meera`, `Kabir`

Statements to type live (Ravi is the imposter, so his is the vague one):

| Person | Statement |
|---|---|
| Asha | It's soft and fits in one hand |
| Ravi | I'd use it every single day |
| Meera | It comes in a bright colour |
| Kabir | You'd find it in a kitchen |

## Imposter checks worth doing

1. **Answer known in advance:** set Ravi under "Who has the empty box?" before
   opening the vote. Phones must not show who it is until you press Reveal.
2. **Answer decided at the end:** Soft refresh, play the round again without setting
   the imposter, then set it just before Reveal.
3. **Live edits:** Edit names mid-round (rename someone, add a 5th person).
4. **Fixing a mistake:** after Award, change the imposter to someone else. Panel
   scores and Top Voters should move to match.
5. **Points:** change the points before awarding. After awarding, the box disappears
   (points are locked so re-scoring stays right).
6. **Skip:** at the end of Segment 1 press **Skip to Segment 2**, then play the
   Imposter round later from **Jump to phase**.
7. **Excel:** Download Excel after the round; the Imposter round has its own rows.

## Audience winners

Right panel → **🏆 Audience winners**. Three prizes, each ranked by most correct
answers, then least total time on those answers (time runs from when that
round's voting opened to the person's final vote):

- **Round 1 Audience Winners**: Segment 1
- **Round 2 Audience Winners**: Segment 2
- **Top Audience Winners**: Segments 1, 2 and 3

Checks worth doing with 2–3 phones:

1. Vote correctly on one phone fast and one slowly; the fast one ranks higher.
2. Show each prize on the big screen; the heading changes, the podium look doesn't.
3. Round 2 → **Skip earlier winners**: anyone on the Round 1 podium is greyed out.
4. **Skip** a person: the next one moves up; **Undo** brings them back.
5. **Download Excel**: the Winners sheet has each prize's podium and top 10.

## Segment reset

Every round card has **↺ Reset segment** in its header. Play a segment, add a
manual score change, then reset it: the segment's panel points and audience
correct answers are taken back, the manual change stays, and phones can vote
again when the round is replayed. Other segments are not touched.
