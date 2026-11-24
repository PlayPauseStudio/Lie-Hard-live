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
