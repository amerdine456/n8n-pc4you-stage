import {
	ICredentialType,
  INodeProperties } from 'n8n-workflow';

// eslint-disable-next-line n8n-nodes-base/cred-class-name-unsuffixed
export class GlpiAPI implements ICredentialType {
	name = 'glpiApi';
	displayName = 'GLPI API';
	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://glpi.example.com/apirest.php',
			description: 'L’URL de base de l’API GLPI (doit inclure /apirest.php)',
			required: true,
		},
		{
			displayName: 'App Token',
			name: 'appToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description: 'App token pour l’authentification à l’API GLPI',
			required: true,
		},
		{
			displayName: 'User Token',
			name: 'userToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description: 'User token pour l’authentification à l’API GLPI',
			required: true,
		},
	];
}
