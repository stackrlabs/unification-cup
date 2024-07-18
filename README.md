# Unification Cup

Micro-rollup for [Avail's Unification Cup 2024](https://lu.ma/tffffuwf)

## State Structure

```ts
type LeagueState = {
  admins: string[];
  meta: { // metadata about the tournament
    round: number;
    startTime: number;
    endTime: number;
    winnerTeamId: number;
    byes: {
      teamId: number;
      round: number;
    }[];
  };
  teams: {
    id: number;
    name: string;
  }[];
  matches: {
    id: number;
    scores: Record<string, number>;
    startTime: number;
    endTime: number;
    penaltyStartTime: number;
    winnerTeamId: number;
  }[];
  players: {
    id: number;
    name: string;
    teamId: number;
    removedAt?: number;
  }[];
  logs: { // logs of all the actions performed in the tournament
    playerId: number;
    matchId?: number;
    timestamp: number;
    action: string;
  }[];
};

```

## Transition Functions

- startTournament: Start the tournament
- startMatch: Start a match with `matchId`
- penaltyShootout: Start a penalty shootout for a match with `matchId`
- endMatch: End a match with `matchId`
- logGoal: Log a goal for a player with `playerId` in a match with `matchId`
- logBlock: Log a block for a player with `playerId` in a match with `matchId`
- logFoul: Log a foul for a player with `playerId` in a match with `matchId`
- logPenaltyHit: Log a penalty hit for a player with `playerId` in a match with `matchId`
- logPenaltyMiss: Log a penalty miss for a player with `playerId` in a match with `matchId`
- addPlayer: Add a player with `playerId` to a team with `teamId`
- removePlayer: Remove a player with `playerId` from a team with `teamId`
- logByes: Log a bye for a team with `teamId`. (Used in case of odd number of teams)
- removeGoal: Remove a goal for a player with `playerId` in a match with `matchId`

## How to run?

### Run using Node.js :rocket:

```bash
npm start
```

### Run using Docker :whale:

- Build the image using the following command: (make sure you replace \`<NPM_TOKEN>\` with the actual value)

```bash
# For Linux
docker build -t unification-league:latest . --build-arg NPM_TOKEN=<NPM_TOKEN>

# For Mac with Apple Silicon chips
docker buildx build --platform linux/amd64,linux/arm64 -t unification-league:latest . --build-arg NPM_TOKEN=<NPM_TOKEN>
```

- Run the Docker container using the following command:

```bash
# If using SQLite as the datastore
docker run -v ./db.sqlite:/app/db.sqlite -p <HOST_PORT>:<CONTAINER_PORT> --name=unification-league -it unification-league:latest

# If using other URI based datastores
docker run -p <HOST_PORT>:<CONTAINER_PORT> --name=unification-league -it unification-league:latest
```
