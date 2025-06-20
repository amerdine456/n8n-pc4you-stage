import {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// eslint-disable-next-line n8n-nodes-base/cred-class-name-unsuffixed
export class MistralAPI implements ICredentialType {
	name = 'mistralApi';
	displayName = 'Mistral API';
	documentationUrl = 'https://docs.mistral.ai/';
	properties: INodeProperties[] = [
			{
					displayName: 'API Key',
					name: 'apiKey',
					type: 'string',
					typeOptions: {
							password: true,
					},
					default: '',
			},
			{
					displayName: 'Base URL',
					name: 'baseUrl',
					type: 'string',
					default: '',
					placeholder: 'http://YOUR_MISTRAL_PATH',
					description: 'The base URL of your Mistral instance',
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
