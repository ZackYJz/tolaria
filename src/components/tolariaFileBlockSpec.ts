import {
	createFileBlockConfig,
	createFileBlockSpec,
	fileParse,
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { TolariaFileBlock } from "./TolariaFileBlock";

const fileBlock = createReactBlockSpec(createFileBlockConfig, {
	meta: { fileBlockAccept: ["*/*"] },
	parse: fileParse(),
	render: TolariaFileBlock,
})();

// Preserve BlockNote's durable HTML/Markdown export; canvas is only a view.
export const tolariaFileBlock = {
	...fileBlock,
	implementation: {
		...fileBlock.implementation,
		toExternalHTML: createFileBlockSpec().implementation.toExternalHTML,
	},
};
