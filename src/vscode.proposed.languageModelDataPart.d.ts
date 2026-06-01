declare module "vscode" {
	/**
	 * A language model response part containing arbitrary data, returned from a {@link LanguageModelChatResponse}.
	 */
	export class LanguageModelDataPart {
		/**
		 * Factory function to create a `LanguageModelDataPart` for an image.
		 * @param data Binary image data
		 * @param mimeType The MIME type of the image
		 */
		static image(data: Uint8Array, mimeType: ChatImageMimeType): LanguageModelDataPart;

		static json(value: object): LanguageModelDataPart;

		static text(value: string): LanguageModelDataPart;

		/**
		 * The mime type which determines how the data property is interpreted.
		 */
		mimeType: string;

		/**
		 * The binary data of this data part.
		 */
		data: Uint8Array;
	}
}
