declare const FIXTURE_VERSION: string;

if (FIXTURE_VERSION === "broken") process.exit(2);
console.log(FIXTURE_VERSION);

export {};
