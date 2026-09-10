export namespace appcore {
	
	export class ActionResult {
	    ok: boolean;
	    error?: string;
	    data?: any;
	
	    static createFrom(source: any = {}) {
	        return new ActionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.error = source["error"];
	        this.data = source["data"];
	    }
	}
	export class OpenResult {
	    mallId: string;
	    shopName: string;
	    webDriverUrl: string;
	    debuggerAddress: string;
	    adapterName: string;
	    adapterInstance: string;
	    openResponse?: Record<string, any>;
	    webDriverRaw?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new OpenResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mallId = source["mallId"];
	        this.shopName = source["shopName"];
	        this.webDriverUrl = source["webDriverUrl"];
	        this.debuggerAddress = source["debuggerAddress"];
	        this.adapterName = source["adapterName"];
	        this.adapterInstance = source["adapterInstance"];
	        this.openResponse = source["openResponse"];
	        this.webDriverRaw = source["webDriverRaw"];
	    }
	}
	export class Settings {
	    activeAdapter: string;
	    zhanfu: Record<string, any>;
	    bitbrowser: Record<string, any>;
	    adspower: Record<string, any>;
	    zhanfuInstances: any[];
	    bitbrowserInstances: any[];
	    adspowerInstances: any[];
	    ai: Record<string, any>;
	    knowledge: Record<string, any>;
	    mail: Record<string, any>;
	    raw?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.activeAdapter = source["activeAdapter"];
	        this.zhanfu = source["zhanfu"];
	        this.bitbrowser = source["bitbrowser"];
	        this.adspower = source["adspower"];
	        this.zhanfuInstances = source["zhanfuInstances"];
	        this.bitbrowserInstances = source["bitbrowserInstances"];
	        this.adspowerInstances = source["adspowerInstances"];
	        this.ai = source["ai"];
	        this.knowledge = source["knowledge"];
	        this.mail = source["mail"];
	        this.raw = source["raw"];
	    }
	}
	export class BootstrapState {
	    rootDir: string;
	    dataDir: string;
	    configPath: string;
	    logPath: string;
	    settings: Settings;
	    lastOpenResult: OpenResult;
	
	    static createFrom(source: any = {}) {
	        return new BootstrapState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rootDir = source["rootDir"];
	        this.dataDir = source["dataDir"];
	        this.configPath = source["configPath"];
	        this.logPath = source["logPath"];
	        this.settings = this.convertValues(source["settings"], Settings);
	        this.lastOpenResult = this.convertValues(source["lastOpenResult"], OpenResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProductCard {
	    title: string;
	    url?: string;
	    imageUrl?: string;
	    manual?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProductCard(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.url = source["url"];
	        this.imageUrl = source["imageUrl"];
	        this.manual = source["manual"];
	    }
	}
	export class InfoLink {
	    label: string;
	    url: string;
	    kind?: string;
	
	    static createFrom(source: any = {}) {
	        return new InfoLink(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.url = source["url"];
	        this.kind = source["kind"];
	    }
	}
	export class MessageAsset {
	    kind: string;
	    path: string;
	    url?: string;
	    width?: number;
	    height?: number;
	    mimeType?: string;
	    source?: string;
	    messageId?: string;
	
	    static createFrom(source: any = {}) {
	        return new MessageAsset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.path = source["path"];
	        this.url = source["url"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.mimeType = source["mimeType"];
	        this.source = source["source"];
	        this.messageId = source["messageId"];
	    }
	}
	export class MessageItem {
	    role: string;
	    text: string;
	    time?: string;
	    senderName?: string;
	    senderEmail?: string;
	    attachments?: MessageAsset[];
	
	    static createFrom(source: any = {}) {
	        return new MessageItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.text = source["text"];
	        this.time = source["time"];
	        this.senderName = source["senderName"];
	        this.senderEmail = source["senderEmail"];
	        this.attachments = this.convertValues(source["attachments"], MessageAsset);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Conversation {
	    id: string;
	    customerName: string;
	    customerFullName: string;
	    customerEmail: string;
	    preview: string;
	    topic: string;
	    lastSeen: string;
	    receivedAt?: string;
	    status: string;
	    sendStatus: string;
	    detailLoaded: boolean;
	    source: string;
	    emailProvider?: string;
	    emailAccount?: string;
	    emailMessageId?: string;
	    emailThreadId?: string;
	    emailInternetId?: string;
	    shopKey?: string;
	    shopName?: string;
	    mallId?: string;
	    conversationId: string;
	    sourceUrl: string;
	    fetchedAt: string;
	    rawLines: string[];
	    messages: MessageItem[];
	    customerProfileLines: string[];
	    orderCartLines: string[];
	    orderLinks: InfoLink[];
	    productCards: ProductCard[];
	    productInterestTitles?: string[];
	    dataSources: string[];
	    dataConflict: boolean;
	    needsReview: boolean;
	    detailFingerprint: string;
	    aiReply: string;
	    aiTranslation: string;
	    aiReplyTranslation: string;
	    aiGenerated: boolean;
	    aiUsed: boolean;
	    aiCaution: boolean;
	    recordPrimary?: string;
	    recordSecondary?: string;
	    recordTertiary?: string;
	    recordRemark?: string;
	    recordClassified?: boolean;
	    duplicateIndex: number;
	    duplicateCount: number;
	
	    static createFrom(source: any = {}) {
	        return new Conversation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.customerName = source["customerName"];
	        this.customerFullName = source["customerFullName"];
	        this.customerEmail = source["customerEmail"];
	        this.preview = source["preview"];
	        this.topic = source["topic"];
	        this.lastSeen = source["lastSeen"];
	        this.receivedAt = source["receivedAt"];
	        this.status = source["status"];
	        this.sendStatus = source["sendStatus"];
	        this.detailLoaded = source["detailLoaded"];
	        this.source = source["source"];
	        this.emailProvider = source["emailProvider"];
	        this.emailAccount = source["emailAccount"];
	        this.emailMessageId = source["emailMessageId"];
	        this.emailThreadId = source["emailThreadId"];
	        this.emailInternetId = source["emailInternetId"];
	        this.shopKey = source["shopKey"];
	        this.shopName = source["shopName"];
	        this.mallId = source["mallId"];
	        this.conversationId = source["conversationId"];
	        this.sourceUrl = source["sourceUrl"];
	        this.fetchedAt = source["fetchedAt"];
	        this.rawLines = source["rawLines"];
	        this.messages = this.convertValues(source["messages"], MessageItem);
	        this.customerProfileLines = source["customerProfileLines"];
	        this.orderCartLines = source["orderCartLines"];
	        this.orderLinks = this.convertValues(source["orderLinks"], InfoLink);
	        this.productCards = this.convertValues(source["productCards"], ProductCard);
	        this.productInterestTitles = source["productInterestTitles"];
	        this.dataSources = source["dataSources"];
	        this.dataConflict = source["dataConflict"];
	        this.needsReview = source["needsReview"];
	        this.detailFingerprint = source["detailFingerprint"];
	        this.aiReply = source["aiReply"];
	        this.aiTranslation = source["aiTranslation"];
	        this.aiReplyTranslation = source["aiReplyTranslation"];
	        this.aiGenerated = source["aiGenerated"];
	        this.aiUsed = source["aiUsed"];
	        this.aiCaution = source["aiCaution"];
	        this.recordPrimary = source["recordPrimary"];
	        this.recordSecondary = source["recordSecondary"];
	        this.recordTertiary = source["recordTertiary"];
	        this.recordRemark = source["recordRemark"];
	        this.recordClassified = source["recordClassified"];
	        this.duplicateIndex = source["duplicateIndex"];
	        this.duplicateCount = source["duplicateCount"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	
	export class Shop {
	    mallId: string;
	    displayName: string;
	    adapterName: string;
	    adapterInstance: string;
	    sourceLabel: string;
	    status?: string;
	    environmentId?: string;
	    environmentIp?: string;
	    mailProvider?: string;
	    mailAccount?: string;
	    serviceEmail?: string;
	    mailAccountSource?: string;
	    mailNetworkMode?: string;
	    mailProxySource?: string;
	    apiAllowed?: boolean;
	    apiToggleable: boolean;
	    apiDisabled?: boolean;
	    apiDisabledReason?: string;
	    proxyConfigured?: boolean;
	    proxyIpMatched?: boolean;
	    proxyLastTestedAt?: string;
	    proxyLastError?: string;
	    apiAuthorized?: boolean;
	    apiLastReadAt?: string;
	    apiLastError?: string;
	    raw?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Shop(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mallId = source["mallId"];
	        this.displayName = source["displayName"];
	        this.adapterName = source["adapterName"];
	        this.adapterInstance = source["adapterInstance"];
	        this.sourceLabel = source["sourceLabel"];
	        this.status = source["status"];
	        this.environmentId = source["environmentId"];
	        this.environmentIp = source["environmentIp"];
	        this.mailProvider = source["mailProvider"];
	        this.mailAccount = source["mailAccount"];
	        this.serviceEmail = source["serviceEmail"];
	        this.mailAccountSource = source["mailAccountSource"];
	        this.mailNetworkMode = source["mailNetworkMode"];
	        this.mailProxySource = source["mailProxySource"];
	        this.apiAllowed = source["apiAllowed"];
	        this.apiToggleable = source["apiToggleable"];
	        this.apiDisabled = source["apiDisabled"];
	        this.apiDisabledReason = source["apiDisabledReason"];
	        this.proxyConfigured = source["proxyConfigured"];
	        this.proxyIpMatched = source["proxyIpMatched"];
	        this.proxyLastTestedAt = source["proxyLastTestedAt"];
	        this.proxyLastError = source["proxyLastError"];
	        this.apiAuthorized = source["apiAuthorized"];
	        this.apiLastReadAt = source["apiLastReadAt"];
	        this.apiLastError = source["apiLastError"];
	        this.raw = source["raw"];
	    }
	}

}

export namespace records {
	
	export class CategoryOption {
	    primary: string;
	    secondary: string;
	    tertiary: string[];
	
	    static createFrom(source: any = {}) {
	        return new CategoryOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.primary = source["primary"];
	        this.secondary = source["secondary"];
	        this.tertiary = source["tertiary"];
	    }
	}
	export class ClassificationDraft {
	    primary: string;
	    secondary: string;
	    tertiary: string;
	    remark: string;
	    autoFilled: boolean;
	    needsReview: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ClassificationDraft(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.primary = source["primary"];
	        this.secondary = source["secondary"];
	        this.tertiary = source["tertiary"];
	        this.remark = source["remark"];
	        this.autoFilled = source["autoFilled"];
	        this.needsReview = source["needsReview"];
	    }
	}

}

