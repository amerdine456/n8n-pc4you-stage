import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeApiError,
  IDataObject,
  IHttpRequestMethods,
} from 'n8n-workflow';

import { cleanEmptyObjects, filterFields, fetchLinkedData } from './GlpiUtils';

/**
 * Implémente un nœud n8n pour interagir avec l'API GLPI, permettant la récupération et le filtrage des données des ressources ordinateurs.
 * Prend en charge la récupération d'informations détaillées, des entités liées et des champs de plugins, avec des options pour sélectionner les champs, filtrer et paginer les résultats.
 * Gère la gestion de session, le traitement des erreurs et l'optimisation des requêtes via la mise en cache et le contrôle de la concurrence.
 */
export class Glpi implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'GLPI',
    name: 'glpi',
    icon: 'file:glpi.svg',
    group: ['input'],
    version: 1,
    subtitle: '= GET {{$parameter["resource"]}}',
    description: 'Interact with GLPI API',
    defaults: { name: 'GLPI' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'glpiApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'hidden',
        default: 'Computer',
        description: 'GLPI resource type to query',
      },
      {
        displayName: 'Fields to Keep',
        name: 'filterFields',
        type: 'fixedCollection',
        placeholder: 'Add fields to keep',
        description: 'Only these fields will be returned in the output',
        typeOptions: { multipleValues: true, sortable: true },
        default: {},
        options: [{
          displayName: 'Fields',
          name: 'fields',
          values: [{ displayName: 'Field Name', name: 'field', type: 'string', default: '' }],
        }],
      },
      {
        displayName: 'Additional Fields',
        name: 'additionalFields',
        type: 'collection',
        placeholder: 'Add Parameter',
        default: {},
        options: [
          {
            displayName: 'ID',
            name: 'id',
            type: 'number',
            default: 1,
            description: 'ID of the resource. If not provided, lists resources.',
          },
          {
            displayName: 'Filters',
            name: 'filters',
            type: 'fixedCollection',
            placeholder: 'Add Filter',
            typeOptions: { multipleValues: true },
            default: {},
            description: 'Filters to apply',
            options: [{
              name: 'filters',
              displayName: 'Filter',
              values: [
                {
                  displayName: 'Field Name',
                  name: 'filterField',
                  type: 'string',
                  default: '',
                  description: 'Name of the field to filter after API response',
                },
                {
                  displayName: 'Value',
                  name: 'filterValue',
                  type: 'string',
                  default: '',
                  description: 'Value to filter for',
                },
              ],
            }],
          },
        ],
      },
      {
        displayName: 'Return All',
        name: 'returnAll',
        type: 'boolean',
        default: false,
        description: 'Whether to return all results or only up to a given limit',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 50,
        displayOptions: { show: { returnAll: [false] } },
        description: 'Max number of results to return',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const credentials = await this.getCredentials('glpiApi') as {
      baseUrl: string;
      appToken: string;
      userToken: string;
    };

    const { baseUrl: rawBaseUrl, appToken, userToken } = credentials;
    const resource = this.getNodeParameter('resource', 0) as string;
    const returnAll = this.getNodeParameter('returnAll', 0) as boolean;
    let limit = 0;
    if (!returnAll) limit = this.getNodeParameter('limit', 0) as number;

    const baseUrl = rawBaseUrl.replace(/\/$/, '');
    const apiUrl = baseUrl.endsWith('apirest.php') ? baseUrl : `${baseUrl}/apirest.php`;

    const authOptions: IDataObject = {
      method: 'GET' as IHttpRequestMethods,
      url: `${apiUrl}/initSession`,
      headers: { 'App-Token': appToken, 'Authorization': `user_token ${userToken}` },
      json: true,
    };

    const authResponse = await this.helpers.request(authOptions);
    if (!authResponse?.session_token) {
      throw new NodeApiError(this.getNode(), authResponse, {
        message: 'GLPI initSession failed, no session token returned',
      });
    }

    const sessionToken = authResponse.session_token;
    const results: IDataObject[] = [];

    const filterFieldsParam = this.getNodeParameter('filterFields', 0, {}) as {
      fields?: Array<{ field: string }>;
    };
    const fieldsToKeep = (filterFieldsParam.fields || []).map(f => f.field).filter(f => !!f);

    const additionalFields = this.getNodeParameter('additionalFields', 0, {}) as IDataObject;
    const id = additionalFields.id as number | undefined;
    const concurrency = (additionalFields.concurrency as number) || 5;

    let filters: Array<{ filterField: string; filterValue: string }> = [];
    if (additionalFields.filters && Array.isArray((additionalFields.filters as any).filters)) {
      filters = ((additionalFields.filters as any).filters as Array<any>)
        .map((f) => ({ filterField: f.filterField, filterValue: f.filterValue }))
        .filter((f) => f.filterField && f.filterValue);
    }

    // Enhanced cache with TTL and request deduplication
    const cache: { [key: string]: { data: any; timestamp: number; promise?: Promise<any> } } = {};
    const CACHE_TTL = 300000; // 5 minutes in milliseconds

    // Enhanced logging with request queue information
    const logApiRequest = (url: string, entityType: string, duration: number, queueLength: number): void => {
      console.log(`[${entityType}] Fetched in ${duration}ms (Queue: ${queueLength}): ${url}`);
    };

    // Request queue management
    let activeRequests = 0;
    const maxConcurrentRequests = Math.min(Math.max(concurrency, 1), 20); // Limit between 1-20

    const fetchDataWithCache = async (url: string, entityType: string): Promise<IDataObject> => {
      const now = Date.now();

      // Check if we have a valid cached response
      if (cache[url] && now - cache[url].timestamp < CACHE_TTL) {
        return cache[url].data;
      }

      // If this URL is already being fetched, return the existing promise
      if (cache[url] && cache[url].promise) {
        return cache[url].promise;
      }

      // Queue management - wait until we have capacity
      while (activeRequests >= maxConcurrentRequests) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      activeRequests++;

      // Create a promise for this request and store it in the cache
      const requestPromise = (async () => {
        try {
          const startTime = Date.now();
          const response = await this.helpers.request({
            method: 'GET' as IHttpRequestMethods,
            url,
            headers: { 'app-token': appToken, 'session-token': sessionToken },
            json: true,
          });
          const duration = Date.now() - startTime;
          logApiRequest(url, entityType, duration, activeRequests);

          // Cache the successful response
          cache[url] = { data: response, timestamp: Date.now() };
          return response;
        } catch (error) {
          console.error(`Error fetching ${entityType} at ${url}:`, error);
          // Don't cache errors
          return {};
        } finally {
          activeRequests--;
          // Clean up the promise reference
          if (cache[url]) {
            delete cache[url].promise;
          }
        }
      })();

      // Store the promise in the cache
      if (!cache[url]) {
        cache[url] = { data: {}, timestamp: 0, promise: requestPromise };
      } else {
        cache[url].promise = requestPromise;
      }

      return requestPromise;
    };

    // Prefetch common data that might be used by multiple entities
    const prefetchCommonData = async (): Promise<void> => {
      const commonResources = [
        'ComputerModel',
        'ComputerType',
        'State',
        'Manufacturer',
        'Location',
        'PluginFieldsComputerFichetest',
        'DeviceGraphicCard',
        'DeviceMemory',
        'DeviceProcessor'
      ];

      await Promise.all(commonResources.map(resourceType =>
        fetchDataWithCache(`${apiUrl}/${resourceType}?range=0-9999`, resourceType)
      ));
    };

    const safeGet = (obj: IDataObject, prop: string): string => {
      if (obj && typeof obj === 'object' && prop in obj) {
        const value = obj[prop];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return String(value);
        }
      }
      return '';
    };

    const processDetailData = async (detailData: IDataObject): Promise<IDataObject> => {
      const linkedData = await fetchLinkedData(
        detailData,
        sessionToken,
        apiUrl,
        appToken,
        this.helpers,
        100,
        3,
        cache
      );

      const modelData: IDataObject = (linkedData.ComputerModel || {}) as IDataObject;
      const typeData: IDataObject = (linkedData.ComputerType || {}) as IDataObject;
      const stateData: IDataObject = (linkedData.State || {}) as IDataObject;
      const manufacturerData: IDataObject = (linkedData.Manufacturer || {}) as IDataObject;
      const locationData: IDataObject = (linkedData.Location || {}) as IDataObject;
			const infocomData: IDataObject[] = (linkedData.Infocom || []) as IDataObject[];

      let processedData: IDataObject = {
        "ID": detailData.id,
        "Nom": detailData.name,
        "Numéro de série": detailData.serial,
        "Modèle": safeGet(modelData, 'name'),
        "Type de produit": safeGet(typeData, 'name'),
        "Fabricant": safeGet(manufacturerData, 'name'),
        "Statut": safeGet(stateData, 'name'),
        "Emplacement": safeGet(locationData, 'name'),
        "value": safeGet(Array.isArray(infocomData) && infocomData.length > 0 ? infocomData[0] : {}, 'value'),

      };

			// Inside processDetailData function, after fetching linkedData
      const graphicsCardDetailsRaw = linkedData.DeviceGraphicCardDetails || [];
      const graphicsCardDetails: IDataObject[] = Array.isArray(graphicsCardDetailsRaw) ? graphicsCardDetailsRaw : [];
      let graphicsCardDesignations: { [designation: string]: number } = {};

      graphicsCardDetails.forEach((detail: IDataObject) => {
        const designation = safeGet(detail, 'designation');
        if (designation) {
          graphicsCardDesignations[designation] = (graphicsCardDesignations[designation] || 0) + 1;
        }
      });

			let formattedGraphicsCardDesignations = '';
			for (const [designation, count] of Object.entries(graphicsCardDesignations)) {
				formattedGraphicsCardDesignations += `${designation}${count > 1 ? ` (x${count})` : ''}\n`;
			}

			processedData['Carte graphique'] = formattedGraphicsCardDesignations.trim();

			// Inside processDetailData function, after fetching linkedData
      const memoryDetailsRaw = linkedData.DeviceMemoryDetails || [];
      const memoryDetails: IDataObject[] = Array.isArray(memoryDetailsRaw) ? memoryDetailsRaw : [];
      let memoryDesignations: { [designation: string]: number } = {};

      memoryDetails.forEach((detail: IDataObject) => {
        const designation = safeGet(detail, 'designation');
        if (designation) {
          memoryDesignations[designation] = (memoryDesignations[designation] || 0) + 1;
        }
      });

			let formattedMemoryDesignations = '';
			for (const [designation, count] of Object.entries(memoryDesignations)) {
				formattedMemoryDesignations += `${designation}${count > 1 ? ` (x${count})` : ''}\n`;
			}

			processedData['Type RAM'] = formattedMemoryDesignations.trim();

			// Inside processDetailData function, after fetching linkedData
			const processorDetailsRaw = linkedData.DeviceProcessorDetails || [];
			const processorDetails: IDataObject[] = Array.isArray(processorDetailsRaw) ? processorDetailsRaw : [];
			const processorManufacturerData: IDataObject = (linkedData.ProcessorManufacturer || {}) as IDataObject;
			let processorDesignations: { [designation: string]: number } = {};
			let processorFrequencies: number[] = [];

			processorDetails.forEach((detail: IDataObject) => {
				const designation = safeGet(detail, 'designation');
				if (designation) {
					processorDesignations[designation] = (processorDesignations[designation] || 0) + 1;
				}

				 let frequencyValue = Number(safeGet(detail, 'frequence'));

				// If frequency is not valid, try to extract from designation
				if (isNaN(frequencyValue) || frequencyValue <= 0) {
					const frequencyMatch = designation.match(/(\d+\.?\d*)\s*(GHz|MHz|Ghz|Mhz)/i);
					if (frequencyMatch) {
						frequencyValue = parseFloat(frequencyMatch[1]);
						const frequencyUnit = frequencyMatch[2].toUpperCase();
						frequencyValue = frequencyUnit === 'GHz' ? frequencyValue * 1000 : frequencyValue;
					}
				}
				if (!isNaN(frequencyValue) && frequencyValue > 0) {
					processorFrequencies.push(frequencyValue);
				}
			});

			// Filter out frequencies that are 0 or undefined
			const validFrequencies = processorFrequencies.filter(freq => freq > 0);

			// Determine the smallest frequency
			let smallestFrequency = validFrequencies.length > 0 ? Math.min(...validFrequencies) : 0;
			let frequencyUnit = smallestFrequency > 20 ? 'MHz' :
				smallestFrequency === 0 ? '' : 'GHz';
			let formattedFrequency = smallestFrequency > 0 ? `${smallestFrequency}${frequencyUnit}` : 'No valid frequency found';

			// Format processor designations
			let formattedProcessorDesignations = '';
			for (const [designation, count] of Object.entries(processorDesignations)) {
				formattedProcessorDesignations += `${designation}${count > 1 ? ` (x${count})` : ''}\n`;
			}
			processedData['Type Processeur'] = formattedProcessorDesignations.trim();
			processedData['Marque Processeur'] = safeGet(processorManufacturerData, 'name');
			processedData['Vitesse Processeur'] = formattedFrequency;

      // Fetch plugin fields data efficiently using cached data
      const pluginFieldsUrl = `${apiUrl}/PluginFieldsComputerFichetest?range=0-9999`;
      const pluginFieldsData = await fetchDataWithCache(pluginFieldsUrl, 'PluginFields');

      if (pluginFieldsData && Array.isArray(pluginFieldsData)) {
        const fieldData = pluginFieldsData.find(field => field.items_id === detailData.id);

        if (fieldData) {
          const hasWebcam = String(fieldData.webcamfield).includes('1') ? 'Oui' : 'Non';
          const hasBluetooth = String(fieldData.bluetoothfield).includes('1') ? 'Oui' : 'Non';
          const LangKeyboard = String(fieldData.plugin_fields_langueclavierfielddropdowns_id).includes('1') ? 'Azerty FR' :
            String(fieldData.plugin_fields_langueclavierfielddropdowns_id).includes('2') ? 'Autre' :
            String(fieldData.plugin_fields_langueclavierfielddropdowns_id).includes('3') ? 'Qwerty' : 'Langage Clavier non spécifié';
          const KeyboardField = String(fieldData.clavierfield) + '\n' + LangKeyboard;
          const hasSerialPort = String(fieldData.portsriefield).includes('1') ? 'Oui' : 'Non';
					const screenSize = Number(safeGet(fieldData, 'tailledelcranfield'));

          processedData['Webcam'] = hasWebcam;
          processedData['WiFi'] = safeGet(fieldData, 'wififield');
          processedData['Bluetooth'] = hasBluetooth;
          processedData['Langue Clavier'] = KeyboardField;
          processedData['Taille écran'] = screenSize > 0 ? `${screenSize}''` : '';
          processedData['Résolution maximale - écran'] = safeGet(fieldData, 'rsolutionmaximalecranfield');
					processedData['USB 2.0'] = safeGet(fieldData, 'nombreportsusbtwozerofield');
					processedData['USB 3.0'] = safeGet(fieldData, 'nombreportsusbthreezerofield');
					processedData['USB Type-C'] = safeGet(fieldData, 'nombreportsusbcfield');
          processedData['Lecteur Optique'] = safeGet(fieldData, 'lecteuroptiquefield');
          processedData['Port Série'] = hasSerialPort;
        }
      }

      processedData = filterFields(cleanEmptyObjects(processedData) || {}, fieldsToKeep);
      return processedData;
    };

    // Process items in batches for better performance
    const processBatch = async (items: IDataObject[]): Promise<IDataObject[]> => {
      const promises = items.map(async (item) => {
        const itemId = item.id;
        if (!itemId) return null;

        const detailData = await fetchDataWithCache(`${apiUrl}/${resource}/${itemId}`, `ComputerDetail-${itemId}`);
        if (!detailData) return null;

        return processDetailData(detailData);
      });

      const results = await Promise.all(promises);
      return results.filter(
        (item): item is IDataObject =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
      );
    };

    // NOUVEAU CODE: Trouver les IDs correspondant à une valeur spécifique dans une entité liée
    const getMatchingEntityIds = async (entityType: string, fieldName: string, fieldValue: string): Promise<Set<number>> => {
      const matchingIds = new Set<number>();
      const entityData = await fetchDataWithCache(`${apiUrl}/${entityType}?expand_dropdowns=true&range=0-9999`, entityType);

      if (Array.isArray(entityData)) {
        entityData.forEach(item => {
          // Compare en ignorant la casse pour plus de souplesse
          if (item[fieldName] && String(item[fieldName]).toLowerCase() === fieldValue.toLowerCase()) {
            matchingIds.add(Number(item.id));
          } else if (item.name && String(item.name).toLowerCase() === fieldValue.toLowerCase()) {
            // Permet également de filtrer sur le nom si le champ spécifié n'existe pas
            matchingIds.add(Number(item.id));
          }
        });
      }
      return matchingIds;
    };

    // NOUVEAU CODE: Préfiltrer les ordinateurs pour ne récupérer que ceux qui correspondent aux filtres
    const getFilteredComputerIds = async (): Promise<Set<number>> => {
      if (filters.length === 0) return new Set<number>(); // Pas de filtres

      const allMatchingSets: Set<number>[] = [];

      // Traiter chaque filtre individuellement
      for (const filter of filters) {
        const { filterField, filterValue } = filter;

        // Correspondance directe des champs courants
        if (filterField === 'Nom' || filterField === 'name') {
          const computers = await fetchDataWithCache(`${apiUrl}/Computer?searchText[name]=${encodeURIComponent(filterValue)}`, 'FilteredComputers');
          if (Array.isArray(computers)) {
            allMatchingSets.push(new Set(computers.map(comp => Number(comp.id))));
          }
        }
        // Correspondance sur numéro de série
        else if (filterField === 'Numéro de série' || filterField === 'serial') {
          const computers = await fetchDataWithCache(`${apiUrl}/Computer?searchText[serial]=${encodeURIComponent(filterValue)}`, 'FilteredComputers');
          if (Array.isArray(computers)) {
            allMatchingSets.push(new Set(computers.map(comp => Number(comp.id))));
          }
        }
        // Filtrer par emplacement (Location)
        else if (filterField === 'Emplacement' || filterField === 'Location') {
          const locationIds = await getMatchingEntityIds('Location', 'name', filterValue);
          if (locationIds.size > 0) {
            const matchingIds = new Set<number>();
            const computers = await fetchDataWithCache(`${apiUrl}/Computer?range=0-9999`, 'AllComputers');
            if (Array.isArray(computers)) {
              computers.forEach(comp => {
                if (locationIds.has(Number(comp.locations_id))) {
                  matchingIds.add(Number(comp.id));
                }
              });
            }
            allMatchingSets.push(matchingIds);
          }
        }
        // Filtrer par état (Status)
        else if (filterField === 'Statut' || filterField === 'State') {
          const stateIds = await getMatchingEntityIds('State', 'name', filterValue);
          if (stateIds.size > 0) {
            const matchingIds = new Set<number>();
            const computers = await fetchDataWithCache(`${apiUrl}/Computer?range=0-9999`, 'AllComputers');
            if (Array.isArray(computers)) {
              computers.forEach(comp => {
                if (stateIds.has(Number(comp.states_id))) {
                  matchingIds.add(Number(comp.id));
                }
              });
            }
            allMatchingSets.push(matchingIds);
          }
        }
        // Filtrer par modèle
        else if (filterField === 'Modèle' || filterField === 'ComputerModel') {
          const modelIds = await getMatchingEntityIds('ComputerModel', 'name', filterValue);
          if (modelIds.size > 0) {
            const matchingIds = new Set<number>();
            const computers = await fetchDataWithCache(`${apiUrl}/Computer?range=0-9999`, 'AllComputers');
            if (Array.isArray(computers)) {
              computers.forEach(comp => {
                if (modelIds.has(Number(comp.computermodels_id))) {
                  matchingIds.add(Number(comp.id));
                }
              });
            }
            allMatchingSets.push(matchingIds);
          }
        }
        // Filtrer par fabricant
        else if (filterField === 'Fabricant' || filterField === 'Manufacturer') {
          const manufacturerIds = await getMatchingEntityIds('Manufacturer', 'name', filterValue);
          if (manufacturerIds.size > 0) {
            const matchingIds = new Set<number>();
            const computers = await fetchDataWithCache(`${apiUrl}/Computer?range=0-9999`, 'AllComputers');
            if (Array.isArray(computers)) {
              computers.forEach(comp => {
                if (manufacturerIds.has(Number(comp.manufacturers_id))) {
                  matchingIds.add(Number(comp.id));
                }
              });
            }
            allMatchingSets.push(matchingIds);
          }
        }
        // Type d'ordinateur
        else if (filterField === 'Type de produit' || filterField === 'ComputerType') {
          const typeIds = await getMatchingEntityIds('ComputerType', 'name', filterValue);
          if (typeIds.size > 0) {
            const matchingIds = new Set<number>();
            const computers = await fetchDataWithCache(`${apiUrl}/Computer?range=0-9999`, 'AllComputers');
            if (Array.isArray(computers)) {
              computers.forEach(comp => {
                if (typeIds.has(Number(comp.computertypes_id))) {
                  matchingIds.add(Number(comp.id));
                }
              });
            }
            allMatchingSets.push(matchingIds);
          }
        }
      }

      // Si nous n'avons trouvé aucune correspondance pour les filtres
      if (allMatchingSets.length === 0) {
        return new Set<number>();
      }

      // Intersection de tous les ensembles d'IDs correspondants (AND logique)
      const finalMatchingIds = new Set<number>(allMatchingSets[0]);
      for (let i = 1; i < allMatchingSets.length; i++) {
        const intersection = new Set<number>();
        for (const id of finalMatchingIds) {
          if (allMatchingSets[i].has(id)) {
            intersection.add(id);
          }
        }
        // Remplacer le set final par l'intersection
        finalMatchingIds.clear();
        for (const id of intersection) {
          finalMatchingIds.add(id);
        }
      }

      return finalMatchingIds;
    };

    try {
      // Start prefetching common data early
      prefetchCommonData();

      if (id !== undefined && id !== null) {
        const detailData = await fetchDataWithCache(`${apiUrl}/${resource}/${id}?expand_dropdowns=true`, 'ComputerDetail');

        if (!detailData) throw new NodeApiError(this.getNode(), detailData, { message: `No data found for ID ${id}` });
        const processed = await processDetailData(detailData);
        results.push(processed);
      } else {
        // NOUVEAU CODE: Filtrer d'abord par les critères fournis
        let computerIdsToProcess: number[] = [];

        if (filters.length > 0) {
          // Récupérer les IDs d'ordinateurs qui correspondent aux filtres
          const matchingIds = await getFilteredComputerIds();

          if (matchingIds.size === 0) {
            // Aucun ordinateur ne correspond aux filtres
            return [results.map(result => ({ json: result }))];
          }

          computerIdsToProcess = Array.from(matchingIds);

          // Limiter le nombre si nécessaire
          if (!returnAll && computerIdsToProcess.length > limit) {
            computerIdsToProcess = computerIdsToProcess.slice(0, limit);
          }

          // Traiter ces ordinateurs par lots
          const batchSize = Math.min(maxConcurrentRequests * 2, 20);
          for (let i = 0; i < computerIdsToProcess.length; i += batchSize) {
            const batchIds = computerIdsToProcess.slice(i, i + batchSize);
            const batchItems = await Promise.all(batchIds.map(async (itemId) => {
              return fetchDataWithCache(`${apiUrl}/${resource}/${itemId}`, `ComputerDetail-${itemId}`);
            }));

            const batchResults = await processBatch(batchItems.filter(item => item !== null && typeof item === 'object'));
            results.push(...batchResults);
          }
        } else {
          // Si pas de filtres, comportement original
          let continueLooping = true;
          let start = 0;
          const step = 50; // Increased batch size for efficiency

          do {
            const response = await fetchDataWithCache(`${apiUrl}/${resource}?expand_dropdowns=true&range=${start}-${start + step - 1}`, 'ComputerList');

            if (!Array.isArray(response) || response.length === 0) {
              continueLooping = false;
              break;
            }

            const limitedResponse = returnAll ? response : response.slice(0, limit - results.length);
            if (limitedResponse.length === 0) break;

            // Process in batches for better performance
            const batchSize = Math.min(maxConcurrentRequests * 2, 20);
            for (let i = 0; i < limitedResponse.length; i += batchSize) {
              const batch = limitedResponse.slice(i, i + batchSize);
              const batchResults = await processBatch(batch);
              results.push(...batchResults);

              // Check if we've reached the limit
              if (!returnAll && results.length >= limit) {
                continueLooping = false;
                break;
              }
            }

            if (response.length < step) {
              continueLooping = false;
            }

            start += step;
          } while (continueLooping);
        }
      }
    } finally {
      try {
        await this.helpers.request({
          method: 'GET' as IHttpRequestMethods,
          url: `${apiUrl}/killSession`,
          headers: { 'app-token': appToken, 'session-token': sessionToken },
          json: true,
        });
      } catch (error) {
        console.error('Error killing session:', error);
      }
    }

    return [results.map(result => ({ json: result }))];
  }
}
