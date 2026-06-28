import { configure, services } from "orangeslice";

const apiKey = process.env.ORANGESLICE_API_KEY;
if (apiKey) {
  configure({ apiKey });
}

export { services };
