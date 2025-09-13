
// Simulate a transient failure about 40% of the time:
if (Math.random() < 0.4) {
  console.error("Simulated flaky test failure");
  process.exit(1);
} else {
  console.log("Tests passed");
}
