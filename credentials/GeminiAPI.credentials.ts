import {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// eslint-disable-next-line n8n-nodes-base/cred-class-name-unsuffixed
export class GeminiAPI implements ICredentialType {
	name = 'geminiApi';
	displayName = 'Gemini API';
	documentationUrl = 'https://docs.n8n.io/integrations/builtin/credentials/google/?utm_source=n8n_app&utm_medium=credential_settings&utm_campaign=create_new_credentials_modal';
	properties: INodeProperties[] = [
			{
					displayName: 'Base URL',
					name: 'baseUrl',
					type: 'string',
					default: 'https://generativelanguage.googleapis.com',
					description: 'The base URL of your Mistral instance',
			},
			{
					displayName: 'API Key',
					name: 'apiKey',
					type: 'string',
					typeOptions: {
							password: true,
					},
					default: '',
			},

	];
	authenticates: IAuthenticateGeneric = {
			type: 'generic',
			properties: {
					headers: {
							'Authorization': '=Bearer {{$credentials.apiKey}}',
					},
			},
	};
}
