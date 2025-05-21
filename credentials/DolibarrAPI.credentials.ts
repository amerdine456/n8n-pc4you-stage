import {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// eslint-disable-next-line n8n-nodes-base/cred-class-name-unsuffixed
export class DolibarrAPI implements ICredentialType {
	name = 'dolibarrApi';
	displayName = 'Dolibarr API';
	documentationUrl = 'https://docs.n8n.io/integrations/creating-nodes/build/declarative-style-node/';
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
					placeholder: 'http://YOUR_DOLIBARR_PATH',
					description: 'The base URL of your Dolibarr instance',
			},
	];
	authenticates: IAuthenticateGeneric = {
			type: 'generic',
			properties: {
					headers: {
							'DOLAPIKEY': '={{$credentials.apiKey}}',
					},
			},
	};
}
