package ai.xzkj.recruitment.browsercompanion;
import jakarta.servlet.*;import jakarta.servlet.http.*;import org.springframework.core.Ordered;import org.springframework.core.annotation.Order;import org.springframework.stereotype.Component;import org.springframework.web.filter.OncePerRequestFilter;import java.io.IOException;
@Component @Order(Ordered.HIGHEST_PRECEDENCE) public class BrowserCompanionCorsFilter extends OncePerRequestFilter{
 @Override protected boolean shouldNotFilter(HttpServletRequest r){return !r.getRequestURI().startsWith("/api/browser-runtime/");}
 @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain)throws ServletException,IOException{String origin=req.getHeader("Origin");if(origin!=null&&origin.startsWith("chrome-extension://")){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");res.setHeader("Access-Control-Max-Age","600");}if("OPTIONS".equals(req.getMethod())){res.setStatus(204);return;}chain.doFilter(req,res);}
}
