import { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';

/**
 * Supprime les objets ou valeurs vides.
 */
export function cleanEmptyObjects(obj: any): any | undefined {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj === 'string' && obj.trim() === '') return undefined;
  if (Array.isArray(obj)) {
    const cleanedArray = obj.map(item => cleanEmptyObjects(item)).filter(item => item !== undefined);
    return cleanedArray.length > 0 ? cleanedArray : undefined;
  }
  if (typeof obj === 'object') {
    const newObj: IDataObject = {};
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const cleanedValue = cleanEmptyObjects(obj[key]);
      if (cleanedValue !== undefined) newObj[key] = cleanedValue;
    }
    return Object.keys(newObj).length > 0 ? newObj : undefined;
  }
  return obj;
}

/**
 * Filtre les clés d'un objet.
 */
export function filterFields(obj: IDataObject | undefined, keys: string[]): IDataObject {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  if (!keys.length) return obj;
  const filtered: IDataObject = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) filtered[key] = obj[key];
  }
  return filtered;
}

/**
 * Formate la liste des modules de mémoire d'un ordinateur dans un format lisible
 */
export function formatMemoryModules(memoryItems: IDataObject[]): string {
  if (!Array.isArray(memoryItems) || memoryItems.length === 0) {
    return 'Non disponible';
  }

  let totalSize = 0;
  const modules: string[] = [];

  memoryItems.forEach((item, index) => {
    const size = Number(item.size) || 0;
    totalSize += size;

    const sizeInGB = size >= 1024 ? (size / 1024).toFixed(1) + ' Go' : size + ' Mo';
    const type = item.devicememories_id || 'Inconnu';
    const serial = item.serial ? `(S/N: ${item.serial})` : '';
    const busID = item.busID ? `Slot ${item.busID}` : `Module ${index + 1}`;

    modules.push(`${busID}: ${sizeInGB} ${type} ${serial}`);
  });

  const totalSizeInGB = totalSize >= 1024 ? (totalSize / 1024).toFixed(1) + ' Go' : totalSize + ' Mo';
  return `Total: ${totalSizeInGB}\n${modules.join('\n')}`;
}

/**
 * Recupère les données liées aux ordinateurs.
 */
export async function fetchLinkedData(
  computerData: IDataObject,
  sessionToken: string,
  apiUrl: string,
  appToken: string,
  helpers: IExecuteFunctions['helpers'],
  requestDelay: number = 100, // Délai entre les requêtes
  maxConcurrency: number = 5, // Limite de requêtes simultanées
  cache: { [key: string]: { data: any; timestamp: number; promise?: Promise<any> } }
): Promise<IDataObject> {
  const allData: IDataObject = {};
  const processedIds = new Set<string>();
  const CACHE_TTL = 300000; // 5 minutes in milliseconds
  let activeRequests = 0; // Compteur de requêtes actives

  // Fonction pour récupérer les données avec mise en cache
  const fetchDataWithCache = async (url: string, entityType: string): Promise<IDataObject> => {
    if (!url) return {};

    const now = Date.now();

    // Vérification si nous avons une réponse mise en cache valide
    if (cache[url] && now - cache[url].timestamp < CACHE_TTL) {
      return cache[url].data;
    }

    // Si cette URL est déjà en cours de récupération, retourner la promesse existante
    if (cache[url] && cache[url].promise) {
      return cache[url].promise;
    }

    // Gestion de la file d'attente - attendre jusqu'à ce que nous ayons de la capacité
    while (activeRequests >= maxConcurrency) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    activeRequests++;

    // Créer une promesse pour cette requête et la stocker dans le cache
    const requestPromise = (async () => {
      try {
        // Ajouter un petit délai aléatoire pour éviter les requêtes simultanées exactes
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));

        const response = await helpers.request({
          method: 'GET' as IHttpRequestMethods,
          url,
          headers: { 'app-token': appToken, 'session-token': sessionToken },
          json: true,
        }).catch(async (error) => {
          if (error.toString().includes('socket hang up') ||
             error.toString().includes('ECONNRESET') ||
             error.toString().includes('timeout')) {
            // Implémenter un backoff exponentiel avec jitter pour les réessais
            const backoffDelay = requestDelay * 3 * (1 + Math.random() * 0.2);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            return helpers.request({
              method: 'GET' as IHttpRequestMethods,
              url,
              headers: { 'app-token': appToken, 'session-token': sessionToken },
              json: true,
            });
          }
          throw error;
        });

        // Mise en cache de la réponse réussie
        cache[url] = { data: response, timestamp: now };
        return response;
      } catch (error) {
        console.error(`Error fetching ${entityType} at ${url}:`, error);
        return {};
      } finally {
        activeRequests--;
        // Nettoyer la référence de la promesse
        if (cache[url]) {
          delete cache[url].promise;
        }
      }
    })();

    // Stocker la promesse dans le cache
    if (!cache[url]) {
      cache[url] = { data: {}, timestamp: 0, promise: requestPromise };
    } else {
      cache[url].promise = requestPromise;
    }

    return requestPromise;
  };

  // Fonction d'aide pour le traitement par lots - plus efficace que la limite de concurrence originale
  const batchFetch = async <T>(
    items: T[],
    processFn: (item: T) => Promise<void>
  ): Promise<void> => {
    // Traiter tous les éléments en parallèle mais contrôler la concurrence via fetchDataWithCache
    await Promise.all(items.map(processFn));
  };

  const computerId = computerData.id;
  if (!computerId) return allData;

  // Préparer toutes les URLs que nous devrons récupérer à l'avance
  const urlsToFetch: { key: string; url: string; entityType: string }[] = [];

  /**
	 * Pour les objets de type "Item_" qui se trouve dans les relations
	 * Ex: Item_DeviceMotherboard, Item_DeviceFirmware, etc
	 * */
	// Relations (composants attachés à cet ordinateur)
  const relationships = [
    { key: 'Item_DeviceGraphicCard', idKey: 'devicegraphiccards_id', dataKey: 'items_id_devicegraphiccards' },
    { key: 'Item_DeviceProcessor', idKey: 'deviceprocessors_id', dataKey: 'items_id_deviceprocessors' },
    { key: 'Item_DeviceMemory', idKey: 'devicememories_id', dataKey: 'items_id_devicememories' },

  ];

	/**
	 * Pour les objets hors "Item_" qui se trouve dans les relations
	 * Ex: Infocom, ReservationItem, etc
	 */
	// Ajouter Infocom aux URLs à récupérer directement
  urlsToFetch.push({
    key: 'Infocom',
    url: `${apiUrl}/Computer/${computerId}/Infocom`,
    entityType: 'Infocom'
  });

  // Ajouter les relations à la liste des URLs à récupérer
  relationships.forEach(({ key }) => {
    urlsToFetch.push({
      key,
      url: `${apiUrl}/Computer/${computerId}/${key}`,
      entityType: key
    });
  });

  // D'abord, récupérer toutes les relations en parallèle
  await batchFetch(relationships, async ({ key, idKey, dataKey }) => {
    const relUrl = `${apiUrl}/Computer/${computerId}/${key}`;
    const relData = await fetchDataWithCache(relUrl, key);
    if (Array.isArray(relData) && relData.length > 0) {
      allData[key] = relData;
      computerData[idKey] = relData[0][idKey];
    } else if (computerData[dataKey]) {
      computerData[idKey] = computerData[dataKey];
    }
  });

  // Maintenant, préparer les URLs pour toutes les entités liées
	/**
	 * Pour les objets de type "Device" qui se trouve dans les relations ou liés directement aux ordinateurs via leurs IDs
	 * Ex: DeviceMotherboard, DeviceGraphicCard, State, Manufacturer, etc
	 */
  const templateUrls = [
    { key: 'ComputerModel', id: computerData.computermodels_id, urlPrefix: 'ComputerModel' },
    { key: 'ComputerType', id: computerData.computertypes_id, urlPrefix: 'ComputerType' },
    { key: 'State', id: computerData.states_id, urlPrefix: 'State' },
    { key: 'Manufacturer', id: computerData.manufacturers_id, urlPrefix: 'Manufacturer' },
    { key: 'Location', id: computerData.locations_id, urlPrefix: 'Location' },
    { key: 'DeviceGraphicCard', id: computerData.devicegraphiccards_id, urlPrefix: 'DeviceGraphicCard' },
    { key: 'DeviceProcessor', id: computerData.deviceprocessors_id, urlPrefix: 'DeviceProcessor' },
    { key: 'DeviceMemory', id: computerData.devicememories_id, urlPrefix: 'DeviceMemory' },
  ].filter(t => t.id && !processedIds.has(t.id.toString()));

  // Ajouter chaque URL de modèle valide à notre file d'attente de récupération
  templateUrls.forEach(({ key, id, urlPrefix }) => {
    if (id != null) {
      processedIds.add(id.toString());
      urlsToFetch.push({
        key,
        url: `${apiUrl}/${urlPrefix}/${id}`,
        entityType: key
      });
    }
  });

	// Après la récupération de Item_DeviceGraphicCard si il y'a plusieurs cartes graphiques
	if (allData.Item_DeviceGraphicCard && Array.isArray(allData.Item_DeviceGraphicCard)) {
		const graphicsCardItems = allData.Item_DeviceGraphicCard as IDataObject[];
		const graphicsCardDetailsPromises = graphicsCardItems.map(async (item) => {
			if (item.devicegraphiccards_id) {
				const graphicsCardDetail = await fetchDataWithCache(
					`${apiUrl}/DeviceGraphicCard/${item.devicegraphiccards_id}`,
					`DeviceGraphicCard_${item.devicegraphiccards_id}`
				);
				return graphicsCardDetail;
			}
			return null;
		});

		const graphicsCardDetails = await Promise.all(graphicsCardDetailsPromises);
		allData.DeviceGraphicCardDetails = graphicsCardDetails.filter(detail => detail !== null);
	}

  // Après la récupération de Item_DeviceMemory si il y'a plusieurs mémoires
	if (allData.Item_DeviceMemory && Array.isArray(allData.Item_DeviceMemory)) {
		const memoryItems = allData.Item_DeviceMemory as IDataObject[];
		const memoryDetailsPromises = memoryItems.map(async (item) => {
			if (item.devicememories_id) {
				const memoryDetail = await fetchDataWithCache(
					`${apiUrl}/DeviceMemory/${item.devicememories_id}`,
					`DeviceMemory_${item.devicememories_id}`
				);
				return memoryDetail;
			}
			return null;
		});

		const memoryDetails = await Promise.all(memoryDetailsPromises);
		allData.DeviceMemoryDetails = memoryDetails.filter(detail => detail !== null);
	}

	// Après la récupération de Item_DeviceProcessor si il y'a plusieurs processeurs
	if (allData.Item_DeviceProcessor && Array.isArray(allData.Item_DeviceProcessor)) {
		const processorItems = allData.Item_DeviceProcessor as IDataObject[];
		const processorDetailsPromises = processorItems.map(async (item) => {
			if (item.deviceprocessors_id) {
				const processorDetail = await fetchDataWithCache(
					`${apiUrl}/DeviceProcessor/${item.deviceprocessors_id}`,
					`DeviceProcessor_${item.deviceprocessors_id}`
				);
				return processorDetail;
			}
			return null;
		});

		const processorDetails = await Promise.all(processorDetailsPromises);
		allData.DeviceProcessorDetails = processorDetails.filter(detail => detail !== null);
	}

  // Récupérer toutes les URLs préparées en parallèle (avec contrôle de concurrence dans fetchDataWithCache)
  await batchFetch(urlsToFetch, async ({ key, url, entityType }) => {
    const data = await fetchDataWithCache(url, entityType);

    // Pour les types de mémoire, stocker avec un ID spécifique dans la clé
    if (key.startsWith('DeviceMemory_')) {
      allData[key] = data;
    } else {
      allData[key] = data;
    }

		// Pour les types de processeur, stocker avec un ID spécifique dans la clé
    if (key.startsWith('DeviceProcessor_')) {
      allData[key] = data;
    } else {
      allData[key] = data;
    }

		// Pour les types de carte graphique, stocker avec un ID spécifique dans la clé
    if (key.startsWith('DeviceGraphicCard_')) {
      allData[key] = data;
    } else {
      allData[key] = data;
    }

    // Ajouter une recherche de fabricant de processeur si nécessaire
    if (key === 'DeviceProcessor' && data.manufacturers_id && !processedIds.has(data.manufacturers_id.toString())) {
      processedIds.add(data.manufacturers_id.toString());
      const manUrl = `${apiUrl}/Manufacturer/${data.manufacturers_id}`;
      const manData = await fetchDataWithCache(manUrl, "ProcessorManufacturer");
      allData.ProcessorManufacturer = manData;
    }
  });

  return allData;
}
