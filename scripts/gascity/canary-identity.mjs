// Claims for the canary Doppler identity. Exact match only. No wildcard.

export const canaryServiceAccount = "wewebplus-canary";
export const githubAudience = "https://github.com/Awannaphasch2016";
export const githubSubject =
  "repo:Awannaphasch2016@28061800/dyad@1384672033:ref:refs/heads/cursor/ecs-hitl-cutover-bbea";
export const workflowRef =
  "Awannaphasch2016/dyad/.github/workflows/canary-verify.yml@refs/heads/cursor/ecs-hitl-cutover-bbea";

export const previewNamesForCanary = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_TOKEN_",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_ZONE_ID_",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ACCOUNT_ID_",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_TEAM_ID",
];

export function canaryIdentityBody() {
  const body = {
    name: "github-canary-verify",
    method: "oidc",
    ttl_seconds: 600,
    config: {
      discovery_url: "https://token.actions.githubusercontent.com",
      claims_type: "exact",
      claims: [
        { key: "aud", values: [githubAudience] },
        { key: "sub", values: [githubSubject] },
        { key: "job_workflow_ref", values: [workflowRef] },
      ],
    },
  };
  for (const claim of body.config.claims) {
    for (const value of claim.values) {
      if (value.includes("*")) {
        throw new Error("Canary identity refuses wildcards");
      }
    }
  }
  return body;
}

export function secretsToCopy(preview, canary) {
  const copy = {};
  for (const name of previewNamesForCanary) {
    if (preview?.[name] && !canary?.[name]) copy[name] = preview[name];
  }
  if (Object.hasOwn(copy, "WEWEBPLUS_DATABASE_URL")) {
    throw new Error("Refusing to copy the database URL");
  }
  return copy;
}

export function matchingIdentity(identities, body = canaryIdentityBody()) {
  return (identities ?? []).find((identity) => {
    if (identity?.name !== body.name) return false;
    const claims = identity.config?.claims ?? identity.claims ?? [];
    return body.config.claims.every((wanted) =>
      claims.some(
        (claim) =>
          claim.key === wanted.key &&
          wanted.values.every((value) =>
            (claim.values ?? []).includes(value),
          ) &&
          (claim.values ?? []).every((value) => !String(value).includes("*")),
      ),
    );
  });
}
