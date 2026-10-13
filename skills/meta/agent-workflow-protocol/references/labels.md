# Labels

Core state labels: `ready-for-agent`, `ready-for-human`, `needs-info`, `agent:log`.

Lease labels: `agent:triage`, `agent:in-progress`, `agent:pr-open`, `agent:stuck`.

Setup creates any missing labels. Only Grooming and later steps change labels; Exploring never does.
