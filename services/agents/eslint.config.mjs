import tseslint from "typescript-eslint";
import base from "../../eslint.config.base.mjs";

export default tseslint.config(...base, { ignores: ["dist/**"] });
