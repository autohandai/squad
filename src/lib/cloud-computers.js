// Cloud computers a member can run on (ADR-0282). Squad does not create
// them yet: each provider is a computer in the person's own account, billed
// by that provider. The steps are the same for every one: create a Linux
// server there, install Squad on it, then add it here Over SSH. No prices
// are shown, so nothing here can go out of date or mislead.
export const CLOUD_PROVIDERS = Object.freeze([
  { id: "hetzner", name: "Hetzner Cloud", where: "EU and US", url: "https://www.hetzner.com/cloud" },
  { id: "digitalocean", name: "DigitalOcean", where: "Worldwide", url: "https://www.digitalocean.com/products/droplets" },
  { id: "lightsail", name: "Amazon Lightsail", where: "Worldwide", url: "https://aws.amazon.com/lightsail/" },
  { id: "fly", name: "Fly.io", where: "Worldwide", url: "https://fly.io/docs/machines/" },
  { id: "own", name: "Your own server", where: "Any Linux or Mac you can SSH into", url: "" },
]);

/** The steps shown for a provider, in order. */
export function cloudSetupSteps(provider) {
  const where = provider?.url ? `on ${provider.name}` : "on your server";
  return [
    `Create a Linux server ${where} (2 GB of memory or more).`,
    "Install Squad on it and start it: open the app, or run `squad serve` on a server without a screen.",
    "On that computer, open Members › Runs on › Share this machine and copy the token.",
    "Here, add it Over SSH, then choose it in a member's Runs on with that token.",
  ];
}
