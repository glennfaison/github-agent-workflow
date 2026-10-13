# Escalate

When an item has failed `max_item_failures` times, or a human must decide:

1. Comment with the reason and the `<!-- agent:escalate step=… -->` marker.
2. Apply `agent:stuck` / route to `ready-for-human` as the step requires.
3. Release any lease.

Do not keep retrying the same failure in a loop.
