
exports.handler = async (event) => {
  console.log("Deploy stage invoked with:", JSON.stringify(event));
  return { statusCode: 200, body: "Hello from Self-Healing Pipeline target!" };
};
