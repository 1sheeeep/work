package cn.xzkj.erp.iam.preparation;

import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.time.Duration;
import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseCookie;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.servlet.function.RouterFunction;
import org.springframework.web.servlet.function.RouterFunctions;
import org.springframework.web.servlet.function.ServerRequest;
import org.springframework.web.servlet.function.ServerResponse;
import org.springframework.web.util.HtmlUtils;

/** Explicitly registered rehearsal surface; no component, production flag or auto-mount. */
public final class IdentityPreparationBrowser {
    public static final String ROOT="/preparation/identity";
    public static final String COOKIE="XZ_IDENTITY_PREPARATION";
    private final UUID tenant;
    private final Supplier<CustomerServiceIdentityPreparation> identity;
    private final Supplier<URI> origin;

    public IdentityPreparationBrowser(UUID tenant,Supplier<CustomerServiceIdentityPreparation> identity,Supplier<URI> origin) {
        this.tenant=java.util.Objects.requireNonNull(tenant);this.identity=identity;this.origin=origin;
    }

    /** Reuses Spring's session-bound synchronizer token, never disables CSRF. */
    public static SecurityFilterChain security(HttpSecurity http) throws Exception {
        return http.securityMatcher(ROOT+"/**")
                .csrf(Customizer.withDefaults()).httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable).logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .authorizeHttpRequests(a->a.anyRequest().permitAll())
                .headers(h->h.contentSecurityPolicy(c->c.policyDirectives("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")))
                .build();
    }

    public RouterFunction<ServerResponse> routes() {
        return RouterFunctions.route().GET(ROOT+"/login",r->form(r,200,"",""))
                .POST(ROOT+"/login",this::login).GET(ROOT+"/workbench",this::workbench)
                .POST(ROOT+"/logout",this::logout)
                .filter((request,next)->{
                    URI expected=origin.get();
                    boolean secure="https".equals(expected.getScheme());
                    if(!(secure || ("http".equals(expected.getScheme()) && "127.0.0.1".equals(expected.getHost()))) ||
                            !expected.getRawAuthority().equals(request.headers().firstHeader("Host")) ||
                            "cross-site".equals(request.headers().firstHeader("Sec-Fetch-Site")) || request.uri().getRawQuery()!=null)
                        return ServerResponse.status(403).build();
                    String supplied=request.headers().firstHeader("Origin");
                    if((supplied!=null && !expected.toString().equals(supplied)) || (request.method().name().equals("POST") && supplied==null))
                        return ServerResponse.status(403).build();
                    if(request.method().name().equals("POST") && (request.servletRequest().getContentLengthLong()<0 || request.servletRequest().getContentLengthLong()>4096))
                        return ServerResponse.status(413).build();
                    return next.handle(request);
                }).build();
    }

    private ServerResponse login(ServerRequest r) {
        if(!parameters(r,Set.of("email","password","_csrf")))return ServerResponse.badRequest().build();
        String email=r.servletRequest().getParameter("email");
        String value=r.servletRequest().getParameter("password");
        char[] password=value==null?null:value.toCharArray();value=null;
        try {
            var issued=identity.get().login(tenant,email,password);
            var session=r.servletRequest().getSession(false);if(session!=null)session.invalidate();
            return ServerResponse.seeOther(URI.create(ROOT+"/workbench"))
                    .header("Set-Cookie",cookie(issued.token(),Duration.ofMinutes(5)))
                    .header("Cache-Control","no-store").build();
        } catch(CustomerServiceIdentityPreparation.Rejected rejected) {
            return form(r,rejected.unavailable()?503:401,email,
                    rejected.unavailable()?"登录服务暂时不可用，请稍后重试。":"账号、密码或业务权限不正确，请核对后重试。");
        } finally {if(password!=null)Arrays.fill(password,'\0');}
    }

    private ServerResponse workbench(ServerRequest r) {
        try {
            var view=identity.get().validateSession(token(r));
            return html(200,"ERP 工作台 · 接入演练","<p role=\"status\">登录成功，当前使用独立 ERP 会话。</p><p>客服接待状态不受此次登录影响。</p><p>当前 ERP 权限数："+view.permissions().size()+"</p>"
                    +"<form method=\"post\" action=\""+ROOT+"/logout\">"+csrf(r)+"<button type=\"submit\">退出 ERP</button></form>");
        } catch(CustomerServiceIdentityPreparation.Rejected rejected) {
            if(rejected.unavailable())return html(503,"登录服务暂时不可用","<p role=\"alert\">未放宽权限，请稍后刷新重试。</p>");
            return ServerResponse.seeOther(URI.create(ROOT+"/login")).header("Set-Cookie",cookie("",Duration.ZERO)).header("Cache-Control","no-store").build();
        }
    }

    private ServerResponse logout(ServerRequest r) {
        if(!parameters(r,Set.of("_csrf")))return ServerResponse.badRequest().build();
        try {identity.get().logout(token(r));}catch(CustomerServiceIdentityPreparation.Rejected ignored) { /* already logged out */ }
        var session=r.servletRequest().getSession(false);if(session!=null)session.invalidate();
        return ServerResponse.seeOther(URI.create(ROOT+"/login")).header("Set-Cookie",cookie("",Duration.ZERO)).header("Cache-Control","no-store").build();
    }

    private ServerResponse form(ServerRequest r,int status,String email,String message) {
        return html(status,"登录 ERP","<p>使用已核对关联的客服账号和密码</p><form method=\"post\" action=\""+ROOT+"/login\">"+csrf(r)
                +"<label for=\"email\">账号</label><input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"username\" maxlength=\"254\" required value=\""+escape(email)+"\">"
                +"<label for=\"password\">密码</label><input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" maxlength=\"72\" required>"
                +(message.isEmpty()?"":"<p class=\"error\" role=\"alert\">"+escape(message)+"</p>")+"<button type=\"submit\">登录</button></form>");
    }

    private String cookie(String value,Duration age) {
        return ResponseCookie.from(COOKIE,value).path(ROOT).httpOnly(true).secure("https".equals(origin.get().getScheme()))
                .sameSite("Strict").maxAge(age).build().toString();
    }
    private static String token(ServerRequest r) {
        Cookie[] cookies=r.servletRequest().getCookies();if(cookies==null)throw new CustomerServiceIdentityPreparation.Rejected(false);
        var matches=Arrays.stream(cookies).filter(c->COOKIE.equals(c.getName())).toList();
        if(matches.size()!=1)throw new CustomerServiceIdentityPreparation.Rejected(false);return matches.getFirst().getValue();
    }
    private static boolean parameters(ServerRequest r,Set<String> allowed) {
        return r.headers().contentType().filter(t->t.isCompatibleWith(MediaType.APPLICATION_FORM_URLENCODED)).isPresent()
                && r.servletRequest().getParameterMap().entrySet().stream().allMatch(e->allowed.contains(e.getKey()) && e.getValue().length==1);
    }
    private static String csrf(ServerRequest r) {
        var token=(CsrfToken)r.servletRequest().getAttribute(CsrfToken.class.getName());
        r.servletRequest().getSession().setMaxInactiveInterval(300);
        return "<input type=\"hidden\" name=\""+escape(token.getParameterName())+"\" value=\""+escape(token.getToken())+"\">";
    }
    private static String escape(String value){return HtmlUtils.htmlEscape(value==null?"":value);}
    private static ServerResponse html(int status,String title,String body) {
        // Native form POSTs under no-referrer can send Origin: null. Keep the
        // same-origin check strict while disclosing no referrer cross-origin.
        return ServerResponse.status(status).contentType(MediaType.TEXT_HTML).header("Cache-Control","no-store").header("Referrer-Policy","same-origin")
                .body("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+escape(title)+"</title><style>"
                        +"*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#172b4d;font:16px/1.6 system-ui,sans-serif}main{max-width:460px;margin:8vh auto;padding:32px;background:white;border:1px solid #d7dfed;border-radius:12px}h1{font-size:26px;margin:0 0 16px}p{color:#425574}label{display:block;margin:18px 0 6px}input,button{font:inherit;width:100%;min-height:46px;border-radius:6px}input{border:1px solid #98a9c2;padding:8px 12px}input:focus,button:focus-visible{outline:3px solid #82b4ff;outline-offset:2px}button{margin-top:24px;border:0;background:#155fce;color:white;cursor:pointer}.error{color:#b42318}.notice{font-size:13px;margin-top:28px}@media(max-width:500px){main{margin:20px 16px;padding:24px}}"
                        +"</style></head><body><main><h1>"+escape(title)+"</h1>"+body+"<p class=\"notice\">仅限隔离接入演练，未连接生产客服或真实店铺。</p></main></body></html>");
    }
}
