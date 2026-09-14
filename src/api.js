import { portalJSON } from './client.js';

function buildPath(appId, env, cluster, ns, suffix) {
  return `/apps/${encodeURIComponent(appId)}/envs/${encodeURIComponent(env)}/clusters/${encodeURIComponent(cluster)}/namespaces/${encodeURIComponent(ns)}${suffix}`;
}

/** GET /apps/{appId}/envs/{env}/clusters/{cluster}/namespaces */
export async function getNamespaces(appId, portalEnv, cluster, opts) {
  return portalJSON('GET', `/apps/${encodeURIComponent(appId)}/envs/${encodeURIComponent(portalEnv)}/clusters/${encodeURIComponent(cluster)}/namespaces`, opts);
}

/** GET .../namespaces/{ns}/items */
export async function getItems(appId, portalEnv, cluster, ns, opts) {
  return portalJSON('GET', buildPath(appId, portalEnv, cluster, ns, '/items'), opts);
}

/** POST .../namespaces/{ns}/item */
export async function createItem(appId, portalEnv, cluster, ns, data, opts) {
  return portalJSON('POST', buildPath(appId, portalEnv, cluster, ns, '/item'), { ...opts, body: data });
}

/** PUT .../namespaces/{ns}/item */
export async function updateItem(appId, portalEnv, cluster, ns, data, opts) {
  return portalJSON('PUT', buildPath(appId, portalEnv, cluster, ns, '/item'), { ...opts, body: data });
}

/** DELETE .../namespaces/{ns}/items/{itemId}?operator=xxx */
export async function deleteItem(appId, portalEnv, cluster, ns, itemId, username, opts) {
  const p = buildPath(appId, portalEnv, cluster, ns, `/items/${itemId}`) + `?operator=${encodeURIComponent(username)}`;
  return portalJSON('DELETE', p, opts);
}

/** POST .../namespaces/{ns}/releases */
export async function publishRelease(appId, portalEnv, cluster, ns, model, opts) {
  const body = {
    appId,
    env: portalEnv,
    clusterName: cluster,
    namespaceName: ns,
    releaseTitle: model.title,
    releaseComment: model.comment || '',
    releasedBy: model.releasedBy || '',
    emergencyPublish: !!model.emergency
  };
  return portalJSON('POST', buildPath(appId, portalEnv, cluster, ns, '/releases'), { ...opts, body });
}

/** GET .../namespaces/{ns}/releases/histories?page=0&size=N */
export async function getActiveReleases(appId, portalEnv, cluster, ns, limit, opts) {
  const p = buildPath(appId, portalEnv, cluster, ns, `/releases/histories?page=0&size=${limit}`);
  return portalJSON('GET', p, opts);
}