import { sleep } from "eve/tools/sleep";

// Durable in-turn wait. Lets the agent handle "remind me in 10 minutes" without
// a schedule row; use create_schedule for anything hours out or recurring.
export default sleep();
