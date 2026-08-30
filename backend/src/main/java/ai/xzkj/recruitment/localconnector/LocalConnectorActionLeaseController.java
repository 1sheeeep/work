package ai.xzkj.recruitment.localconnector;

import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
class LocalConnectorActionLeaseController {
    private final LocalConnectorActionLeaseService service;LocalConnectorActionLeaseController(LocalConnectorActionLeaseService service){this.service=service;}
    @PostMapping("/api/local-connector/runtime/action-leases/claim")ActionLeaseClaimResponse claim(@RequestHeader(HttpHeaders.AUTHORIZATION)String token){return service.claim(token);}
    @PostMapping("/api/local-connector/runtime/action-leases/receipt")ActionLeaseResponse receipt(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody ActionLeaseReceiptRequest request){return service.receipt(token,request);}
    @GetMapping("/api/local-connector/action-leases")List<ActionLeaseResponse> list(){return service.list();}
}
