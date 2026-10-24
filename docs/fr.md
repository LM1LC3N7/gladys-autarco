# Autarco

Intégration **non officielle**, sans lien avec Autarco. Elle lit les
installations de votre compte **Autarco** (onduleurs solaires, et batteries
s'il y en a) par l'API publique de my.autarco.com, avec l'adresse e-mail et
le mot de passe du compte. Internet est nécessaire.

**Jamais testé avec un vrai appareil** : l'intégration a été écrite à partir
de la bibliothèque [python-autarco](https://github.com/klaasnicolaas/python-autarco)
(celle qu'utilise Home Assistant) et de ses réponses de test, sans compte
Autarco sous la main. Vos retours sont les bienvenus.

## Lecture seule

L'intégration **ne fait que lire** (requêtes GET de l'API publique). Elle ne
change rien sur votre installation ni dans votre compte.

## Ce que vous obtenez

Un appareil par **installation** (site) du compte, à son nom :

- puissance solaire (W) et **l'index de production solaire** (la production
  totale de l'installation, en kWh), pour le suivi énergétique de Gladys, avec
  sa production par demi-heure calculée par Gladys ;
- production du jour et du mois (kWh, simples capteurs, jamais comptés) ;
- santé de l'installation (1 = OK, 0 = un problème signalé par Autarco).

Avec une batterie (les valeurs n'apparaissent que si Autarco les donne) :

- niveau de charge (%) ;
- puissance de la batterie et puissance de charge nette (W), **telles que
  données par Autarco** : leur signe (charge ou décharge) n'a pas été
  confirmé sur une vraie installation, ce sont donc de simples capteurs
  signés, jamais séparés en charge et décharge ;
- énergie chargée et déchargée du jour et totale (kWh, simples capteurs).

Avec un compteur (prouvé par une valeur du réseau ; sans compteur, Autarco
répète la production comme consommation, alors laissée de côté) : import
net et export du réseau (W, signes tels que donnés), totaux d'import et
d'export (kWh), consommation (W, du jour, totale). Tous de simples
capteurs.

Un appareil par **onduleur** : puissance (W), production totale (kWh, simple
capteur), santé, réseau coupé (0/1). La puissance d'un onduleur dont le
dernier message date de plus de 2 heures (selon l'horloge du service) n'est
pas envoyée.

### Pas de double comptage

Seule la **production solaire totale** de chaque installation alimente le
suivi énergétique de Gladys, comme index. Les compteurs du jour et du mois,
l'import du réseau (le compteur principal de votre logement, Linky..., le
compte déjà), l'injection et les compteurs de la batterie sont de **simples
capteurs** : Gladys ne les compte ni ne les facture jamais, et l'intégration
n'envoie jamais de consommation journalière. Si une autre intégration envoie
déjà la même production solaire à Gladys, ne créez qu'un seul des deux index
de production.

L'API donne des kWh entiers : l'index monte par pas de 1 kWh.

## Prérequis

- Gladys 5.2.0 ou plus récent, avec un accès à Internet.
- Un compte Autarco sur my.autarco.com (celui de l'application Autarco).

## Configuration

1. Installez l'intégration depuis le store de Gladys.
2. **Adresse e-mail** et **Mot de passe** de votre compte Autarco. Le mot de
   passe est gardé par Gladys dans sa base, jamais réaffiché, envoyé
   seulement à my.autarco.com (HTTPS, dans l'en-tête de ses requêtes), jamais
   journalisé.
3. **Intervalle de lecture** : 300 s par défaut (le rythme auquel le portail
   se met à jour), de 120 à 3600 s. Chaque lecture fait une requête pour le
   compte, puis trois par installation.
4. Après la première lecture, créez les appareils depuis l'onglet
   **Découverte**.

Le bouton **Tester la connexion** lit le compte une fois si l'intervalle est
écoulé ; sinon il affiche la dernière lecture et l'heure de la prochaine
possible.

Seules les 30 premières installations du compte sont lues (la première page
de l'API) ; l'état le signale s'il y en a d'autres.

## Rythme des lectures

Rien ne lit le compte plus vite que l'intervalle : ni le bouton de test, ni
l'onglet Découverte, ni une reconnexion à Gladys, ni l'enregistrement d'une
configuration inchangée, ni un redémarrage du conteneur (l'heure de la
dernière lecture est gardée dans `/data`, écrite au plus une fois par minute
et à l'arrêt propre : après un redémarrage, la première lecture attend
l'intervalle plus une minute). De nouveaux identifiants sont essayés tout de
suite.

## Index retenu

Gladys compte chaque hausse d'un index en entier. Pour qu'aucune énergie
fictive ne soit jamais comptée, l'index de production solaire de chaque
installation passe par une garde :

- une valeur 0 n'est jamais envoyée ;
- une baisse, ou une hausse plus rapide que 50 kW en moyenne (plus 1,5 kWh),
  est **retenue** : la dernière valeur acceptée est renvoyée, et l'état de
  l'intégration l'affiche. Ni le temps ni la répétition ne la confirment ;
  une baisse qui remonte est reprise dès qu'elle dépasse la dernière valeur
  acceptée ;
- si elle est juste, cliquez **deux fois** sur **Accepter l'index retenu** :
  le premier clic liste ce qui est retenu et n'accepte rien, le second, de
  3 secondes à 5 minutes plus tard, accepte exactement ce qui a été listé (un
  saut est alors compté d'un coup, une baisse ne compte rien). Enregistrer la
  configuration n'accepte rien.

## Erreurs

- **E-mail ou mot de passe refusé** (HTTP 401 du compte) : les lectures
  **s'arrêtent**, l'état le dit, et **aucun nouvel essai n'est fait
  automatiquement** (cet arrêt est gardé dans `/data` après un redémarrage).
  Vérifiez vos identifiants sur my.autarco.com et enregistrez les
  identifiants **corrigés** : de nouveaux identifiants sont essayés tout de
  suite. Réenregistrer des identifiants inchangés ne lit rien ; seul le
  bouton **Tester la connexion** les réessaie (une fois par clic, au rythme
  des lectures), et seul un succès lève l'arrêt. Pour reconnaître les
  identifiants refusés après un redémarrage, `/data` n'en garde qu'un
  marqueur de 8 bits (il ne peut confirmer aucun mot de passe), effacé à la
  première lecture réussie.
- **Un mot de passe avec des accents** ou d'autres caractères non ASCII :
  l'intégration l'envoie en UTF-8, alors que la bibliothèque d'origine
  l'envoie en latin1 ; on ne sait pas encore lequel Autarco attend. Si un tel
  mot de passe est refusé alors qu'il marche sur my.autarco.com, un mot de
  passe en caractères ASCII simples lève le doute (et dites-le-nous).
- **HTTP 429** (trop de requêtes), où que ce soit : les lectures se mettent
  en pause, du délai demandé par Autarco, sinon 1 minute doublée à chaque
  nouvelle fois, mais jamais moins que l'intervalle de lecture (à 300 s : 5,
  5, 5, 8, 16... minutes), jusqu'à 6 heures, gardée dans `/data`. Un
  **HTTP 5xx** ou **403** du compte met en pause de la même façon.
- Une erreur d'une installation (5xx, réponse étrange) ne laisse de côté que
  ses valeurs : les autres sont publiées. Une installation qui ne répond pas
  à temps s'arrête là, et la lecture continue avec les suivantes ; seuls
  Autarco injoignable, ou deux installations de suite sans réponse, arrêtent
  le reste de la lecture. La première installation lue change à chaque
  lecture, pour qu'aucune ne reste toujours la dernière. L'état cite les
  installations non lues en entier, et dit si les autres sont à jour.
- Une installation qui refuse l'accès (401 ou 403) alors que le compte est
  accepté est laissée de côté, réessayée plus tard (l'intervalle doublé,
  jusqu'à une fois par heure) ; l'état la cite.
- La puissance solaire d'une installation n'est pas envoyée quand tous ses
  onduleurs à l'heure connue se taisent depuis plus de 2 heures (selon
  l'horloge du service) : ce n'est pas une valeur actuelle.
- Autarco injoignable : nouvel essai après l'intervalle, doublé jusqu'à
  30 minutes.

## Confidentialité

L'intégration ne parle qu'à my.autarco.com, en HTTPS, et ne suit aucune
redirection : vos identifiants ne vont jamais ailleurs. Ni l'adresse e-mail ni
le mot de passe ne sont jamais écrits dans les journaux, dans l'état ou dans
`/data` (le compte n'y est gardé que sous forme d'empreinte salée). Les noms
des installations ne sont gardés qu'en mémoire.
